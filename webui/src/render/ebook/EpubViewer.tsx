// render/ebook/EpubViewer.tsx
// EPUB 电子书渲染：epubjs 将 EPUB 渲染为分页阅读器（iframe 沙箱 + blobUrl 资源替换）。
// 关闭页面脚本（allowScriptedContent: false），防止不受信电子书在宿主上下文执行脚本。
//
// 健壮性（空白兜底）：epubjs 的渲染队列被 book.opened 阻塞，而打开失败仅 console.error、
// 该 Promise 永不 settle → 静默白屏（display 既不 resolve 也不 reject）。这里加看门狗：
// 首章渲染（rendered 事件）前超时即视为失败 → 先用「宽松模式（跳过资源替换 + 连续滚动）」
// 重试 → 仍失败则抛出，交给 FilePreviewPane 的 PreviewErrorBoundary 回退为后端文本提取。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, List } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  toTocNodes,
  flattenForRender,
  resolveSection,
  type EpubNavItemLike,
  type EpubSectionLike,
  type TocNode,
} from './epub-toc';

// ── epubjs 结构类型（库自带的 tsd-jsdoc 类型过宽，这里用最小结构约束，避免 any） ──

/** rendition 位置（relocated 事件负载的最小结构） */
interface EpubLocation {
  start?: {
    index?: number;
    href?: string;
    displayed?: { page?: number; total?: number };
  };
  atStart?: boolean;
  atEnd?: boolean;
}

/** iframe 内容（hooks.content 触发的实参：view 与 contents 都带 document 属性） */
interface EpubContents {
  document?: Document;
}

interface EpubHook<T> {
  register(fn: (arg: T, rendition?: unknown) => void): void;
}

interface EpubRendition {
  display(target?: string | number): Promise<void>;
  destroy(): void;
  next(): Promise<void>;
  prev(): Promise<void>;
  /** 容器尺寸变化时重排（epubjs 百分比模式不会自动响应容器变化，必须显式调用） */
  resize?(width: number, height: number): void;
  themes?: { default(css: Record<string, unknown>): void };
  /** 内容钩子：每章内容就绪时触发（用于注入宿主侧点击翻页监听） */
  hooks?: { content?: EpubHook<EpubContents> };
  /** EventEmitter：rendered / relocated / displayError 等 */
  on?(event: string, handler: (...args: unknown[]) => void): void;
}

interface EpubBook {
  renderTo(el: HTMLElement, opts?: Record<string, unknown>): EpubRendition;
  loaded: { navigation: Promise<{ toc?: EpubNavItemLike[] }> };
  ready?: Promise<void>;
  /** spine：按 href / 索引 / CFI 取章节（TOC 跳转前用它校验目标是否存在） */
  spine?: {
    get(target?: string | number): EpubSectionLike | null;
    length?: number;
  };
  /** 路径解析：把相对路径按 OPF 目录解析（absolute=false 时不加 archive url 前缀） */
  resolve?: (path: string, absolute?: boolean) => string;
  /** OPF 解析结果：navPath（EPUB3 nav）/ ncxPath（EPUB2 NCX）；目录 href 归一化兜底用 */
  packaging?: { navPath?: string | false; ncxPath?: string | false };
  /** EventEmitter：openFailed 等失败事件（epubjs 失败默认只 console.error） */
  on?(event: string, handler: (...args: unknown[]) => void): void;
  destroy(): void;
}

type EpubFactory = (input: ArrayBuffer, opts?: Record<string, unknown>) => EpubBook;

export interface EpubViewerProps {
  buffer: ArrayBuffer;
}

/** 已注入点击翻页监听的 iframe document（模块级 WeakSet，避免重复绑定；不用 any） */
const tapInstalled = new WeakSet<Document>();

interface ReadingProgress {
  page: number;
  total: number;
  index: number;
  count: number;
  atStart: boolean;
  atEnd: boolean;
}

interface NavHandle {
  prev: () => void;
  next: () => void;
  first: () => void;
  last: () => void;
}

/** 看门狗：首章渲染前等待上限（毫秒） */
const WATCHDOG_MS = 12_000;

export function EpubViewer({ buffer }: EpubViewerProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<EpubRendition | null>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const navRef = useRef<NavHandle | null>(null);
  const [toc, setToc] = useState<TocNode[]>([]);
  const [showToc, setShowToc] = useState(false);
  const [progress, setProgress] = useState<ReadingProgress | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [fatal, setFatal] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // el：非空别名——hoisted 函数体内 TS 不保留外层 null 收窄，故显式取非空常量
    const el: HTMLDivElement = container;
    let cancelled = false;
    let attempt = 0; // 0=默认(paginated+blobUrl) 1=宽松(scrolled-doc+none)
    let mounting = false;
    let rendered = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let ro: ResizeObserver | null = null;
    setFatal(false);
    setDegraded(false);
    setToc([]);
    setProgress(null);

    const clearWatchdog = (): void => {
      if (watchdog !== null) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    };

    const destroyActive = (): void => {
      clearWatchdog();
      try {
        renditionRef.current?.destroy();
      } catch {
        // destroy 失败不影响重试/卸载
      }
      try {
        bookRef.current?.destroy();
      } catch {
        // 忽略
      }
      renditionRef.current = null;
      bookRef.current = null;
      el.innerHTML = '';
    };

    // ── 导航中枢（工具栏 / 键盘 / 正文点击共用） ──
    const go = (dir: 'prev' | 'next'): void => {
      const r = renditionRef.current;
      if (!r) return;
      void (dir === 'next' ? r.next() : r.prev()).catch(() => {
        // 到达首/末页忽略
      });
    };
    navRef.current = {
      prev: () => go('prev'),
      next: () => go('next'),
      first: () => {
        void renditionRef.current?.display(0).catch(() => undefined);
      },
      last: () => {
        const len = bookRef.current?.spine?.length ?? 0;
        if (len > 0) void renditionRef.current?.display(len - 1).catch(() => undefined);
      },
    };

    // ── 正文点击翻页：左右各 25% 区域，链接放行 ──
    const installTap = (arg: EpubContents): void => {
      const doc = arg.document;
      if (!doc || tapInstalled.has(doc)) return;
      tapInstalled.add(doc);
      doc.addEventListener('click', (ev: MouseEvent) => {
        const target = ev.target instanceof Element ? ev.target : null;
        if (target?.closest('a')) return; // 书内链接照常工作
        const width = doc.documentElement?.clientWidth ?? 0;
        if (width <= 0) return;
        const ratio = ev.clientX / width;
        if (ratio <= 0.25) go('prev');
        else if (ratio >= 0.75) go('next');
        rootRef.current?.focus(); // 让后续键盘翻页生效
      });
    };

    const onRelocated = (arg: unknown): void => {
      if (cancelled) return;
      const loc = arg as EpubLocation | undefined;
      const start = loc?.start;
      setProgress({
        page: start?.displayed?.page ?? 1,
        total: start?.displayed?.total ?? 1,
        index: (start?.index ?? 0) + 1,
        count: bookRef.current?.spine?.length ?? 1,
        atStart: loc?.atStart === true,
        atEnd: loc?.atEnd === true,
      });
    };

    async function mount(permissive: boolean): Promise<void> {
      if (mounting || cancelled) return;
      mounting = true;
      rendered = false;
      try {
        // epubjs 自带类型过宽，这里按其文档签名收窄
        const mod = await import('epubjs');
        if (cancelled) return;
        const ePub = (mod.default ?? mod) as unknown as EpubFactory;
        const flow = permissive ? 'scrolled-doc' : 'paginated';
        const book = ePub(buffer.slice(0), { replacements: permissive ? 'none' : 'blobUrl' });
        bookRef.current = book;
        book.on?.('openFailed', () => failOrRetry());
        if (cancelled) {
          try {
            book.destroy();
          } catch {
            // 忽略
          }
          bookRef.current = null;
          return;
        }

        // 目录独立加载：不依赖 display 是否 resolve（否则 display 挂起时目录也不出现）
        void book.loaded.navigation
          .then((nav) => {
            if (!cancelled) setToc(toTocNodes(nav?.toc));
          })
          .catch(() => undefined);

        // 尺寸就绪才 renderTo（容器测得 0 时交给 ResizeObserver 再次触发）
        const w = Math.round(el.clientWidth);
        const h = Math.round(el.clientHeight);
        if (w <= 0 || h <= 0) return;

        const r = book.renderTo(el, { width: w, height: h, flow, allowScriptedContent: false });
        renditionRef.current = r;
        if (permissive) setDegraded(true);
        // 白纸观感（含 html 兜底，避免 iframe 根节点透明露出深色底）
        r.themes?.default({ html: { background: '#ffffff' }, body: { color: '#111111', background: '#ffffff' } });
        r.hooks?.content?.register(installTap);
        // 首章渲染成功 = 可用 → 撤掉看门狗
        r.on?.('rendered', () => {
          rendered = true;
          clearWatchdog();
        });
        r.on?.('relocated', onRelocated);
        // 首章渲染前出错才视为失败（渲染成功后的个别章节 displayError 不应触发整书重试）
        r.on?.('displayError', () => {
          if (!rendered) failOrRetry();
        });
        void r.display().catch(() => failOrRetry());
        watchdog = setTimeout(() => failOrRetry(), WATCHDOG_MS);
      } catch (err: unknown) {
        console.warn('epub mount failed:', err instanceof Error ? err.message : String(err));
        failOrRetry();
      } finally {
        mounting = false;
      }
    }

    function failOrRetry(): void {
      if (cancelled) return;
      if (attempt === 0) {
        attempt = 1;
        destroyActive();
        void mount(true);
      } else {
        // 两轮都失败 → 抛出，交给 PreviewErrorBoundary 回退后端文本提取（不再白屏）
        setFatal(true);
      }
    }

    const tryMountOrResize = (): void => {
      if (cancelled) return;
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (w <= 0 || h <= 0) return;
      if (renditionRef.current === null && bookRef.current === null) {
        if (!mounting) void mount(attempt === 1);
      } else {
        renditionRef.current?.resize?.(w, h);
      }
    };

    ro = new ResizeObserver(() => tryMountOrResize());
    ro.observe(el);
    tryMountOrResize();

    return () => {
      cancelled = true;
      ro?.disconnect();
      ro = null;
      navRef.current = null;
      destroyActive();
    };
  }, [buffer]);

  // 最终失败：抛给 PreviewErrorBoundary（fallback = FallbackPreview → 后端文本提取）
  if (fatal) throw new Error('EPUB render failed');

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const nav = navRef.current;
    if (!nav) return;
    switch (e.key) {
      case 'ArrowLeft':
      case 'PageUp':
        nav.prev();
        e.preventDefault();
        break;
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        nav.next();
        e.preventDefault();
        break;
      case 'Home':
        nav.first();
        e.preventDefault();
        break;
      case 'End':
        nav.last();
        e.preventDefault();
        break;
      default:
        break;
    }
  };

  const jump = (href: string): void => {
    setShowToc(false);
    const r = renditionRef.current;
    if (!r) return;
    const hashIdx = href.indexOf('#');
    const frag = hashIdx >= 0 ? href.slice(hashIdx + 1) : '';
    const section = resolveSection(bookRef.current, href);
    const base = section?.href ?? href.split('#')[0];
    // 关键：目标串必须含 '#'，否则 epubjs 会当作「无目标」而丢弃锚点（只到章节起点）
    const target = frag ? `${base}#${frag}` : base;
    void r.display(target).catch((err: unknown) => {
      // href 形态不匹配（No Section Found 等）→ 按 spine 下标兜底（下标形态在 epubjs 中必定可用）
      if (section && typeof section.index === 'number') {
        void r.display(section.index).catch(() => undefined);
      }
      console.warn('epub toc jump failed:', err);
    });
  };

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative flex h-full min-h-0 flex-col gap-2 outline-none"
    >
      <div className="relative z-10 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => navRef.current?.prev()}
            disabled={progress?.atStart === true}
            aria-label={t('preview.pagePrev')}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => navRef.current?.next()}
            disabled={progress?.atEnd === true}
            aria-label={t('preview.pageNext')}
          >
            <ChevronRight className="size-4" />
          </Button>
          {progress && (
            <span className="truncate text-[11px] tabular-nums text-muted-foreground">
              {t('preview.readingProgress', {
                page: progress.page,
                total: progress.total,
                index: progress.index,
                count: progress.count,
              })}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {degraded && (
            <span className="text-[11px] text-muted-foreground">{t('preview.epubDegraded')}</span>
          )}
          {toc.length > 0 && (
            <Button
              variant={showToc ? 'default' : 'outline'}
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => setShowToc((v) => !v)}
            >
              <List className="size-3.5" />
              {t('preview.toc')}
            </Button>
          )}
        </div>
      </div>
      {showToc && (
        // 目录浮层：刻意「脱离文档流」（absolute）——若作为流内兄弟节点，展开/收起会改变
        // 阅读容器高度 → ResizeObserver → rendition.resize() → epubjs 用旧位置重新 display
        // → 覆盖目录跳转（表现为点不动 / 跳一下弹回）。浮层使容器尺寸恒定，彻底规避。
        <div className="absolute right-2 top-9 z-20 max-h-[60%] w-72 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
          {flattenForRender(toc).map(({ node, depth, key }) =>
            node.href ? (
              <button
                key={key}
                type="button"
                onClick={() => jump(node.href)}
                className="block w-full truncate rounded px-2 py-1 text-left text-xs text-foreground hover:bg-muted"
                style={{ paddingLeft: `${8 + depth * 12}px` }}
                title={node.label}
              >
                {node.label}
              </button>
            ) : (
              // 分组标题（无 href）：保留名称、不可点击
              <div
                key={key}
                className="truncate px-2 py-1 text-left text-xs font-medium text-muted-foreground"
                style={{ paddingLeft: `${8 + depth * 12}px` }}
                title={node.label}
              >
                {node.label}
              </div>
            ),
          )}
        </div>
      )}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden rounded border border-border bg-background" />
    </div>
  );
}