// render/ebook/EpubViewer.tsx
// EPUB 电子书渲染：epubjs 将 EPUB 渲染为分页阅读器（iframe 沙箱 + blobUrl 资源替换）。
// 关闭页面脚本（allowScriptedContent: false），防止不受信电子书在宿主上下文执行脚本。
// 懒加载；解析或渲染失败 → 由 FilePreviewPane 回退到后端文本提取。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, List } from 'lucide-react';
import { Button } from '../../components/ui/button';

// ── epubjs 结构类型（库自带的 tsd-jsdoc 类型过宽，这里用最小结构约束，避免 any） ──

interface EpubNavItem {
  label?: string;
  href?: string;
  subitems?: EpubNavItem[];
}

interface EpubRendition {
  display(target?: string): Promise<void>;
  destroy(): void;
  next(): Promise<void>;
  prev(): Promise<void>;
}

interface EpubBook {
  renderTo(el: HTMLElement, opts?: Record<string, unknown>): EpubRendition;
  loaded: { navigation: Promise<{ toc?: EpubNavItem[] }> };
  destroy(): void;
}

type EpubFactory = (input: ArrayBuffer, opts?: Record<string, unknown>) => EpubBook;

export interface EpubViewerProps {
  buffer: ArrayBuffer;
}

/** 扁平化目录（只取一层子项，避免深层嵌套撑爆侧边栏） */
function flattenToc(items: EpubNavItem[] | undefined): Array<{ label: string; href: string }> {
  if (!items) return [];
  const out: Array<{ label: string; href: string }> = [];
  for (const item of items) {
    if (item.label && item.href) out.push({ label: item.label.trim(), href: item.href });
    if (item.subitems) out.push(...flattenToc(item.subitems));
  }
  return out;
}

export function EpubViewer({ buffer }: EpubViewerProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<EpubRendition | null>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toc, setToc] = useState<Array<{ label: string; href: string }>>([]);
  const [showToc, setShowToc] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    setError(null);
    setToc([]);

    void (async () => {
      try {
        // epubjs 自带类型过宽，这里按其文档签名收窄
        const mod = await import('epubjs');
        const ePub = (mod.default ?? mod) as unknown as EpubFactory;
        // 拷贝一份（epubjs 可能对传入 buffer 做 ArrayBuffer 转移）
        const data = buffer.slice(0);
        const book = ePub(data, { replacements: 'blobUrl' });
        bookRef.current = book;
        const rendition = book.renderTo(container, {
          width: '100%',
          height: '100%',
          flow: 'paginated',
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;
        await rendition.display();
        if (cancelled) return;
        const nav = await book.loaded.navigation;
        setToc(flattenToc(nav?.toc));
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      try {
        renditionRef.current?.destroy();
      } catch {
        // destroy 失败不影响卸载
      }
      try {
        bookRef.current?.destroy();
      } catch {
        // 忽略
      }
      renditionRef.current = null;
      bookRef.current = null;
    };
  }, [buffer]);

  const goto = (dir: 'prev' | 'next') => {
    const r = renditionRef.current;
    if (!r) return;
    void (dir === 'next' ? r.next() : r.prev()).catch(() => {
      // 到达首/末页忽略
    });
  };

  const jump = (href: string) => {
    setShowToc(false);
    void renditionRef.current?.display(href).catch(() => {
      // 无效锚点忽略
    });
  };

  if (error !== null) {
    return <div className="flex h-full items-center justify-center text-sm text-destructive">{error}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => goto('prev')}
            aria-label={t('preview.toc')}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => goto('next')}
            aria-label={t('preview.toc')}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
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
      {showToc && (
        <div className="max-h-40 shrink-0 overflow-y-auto rounded border border-border p-1">
          {toc.map((item, i) => (
            <button
              key={`${item.href}-${i}`}
              type="button"
              onClick={() => jump(item.href)}
              className="block w-full truncate rounded px-2 py-1 text-left text-xs text-foreground hover:bg-muted"
              title={item.label}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden rounded border border-border bg-background" />
    </div>
  );
}