// render/file/FilePreviewPane.tsx
// 文件预览面板：按 RendererKind 懒加载分发渲染器（打开/激活时才加载对应引擎 chunk）。
// 每一级渲染器均包 PreviewErrorBoundary，出错自动落到「回退链」下一级，最终落到 FallbackPreview。
// 高度由 heightClass 决定：弹层传固定高度，侧边栏默认 h-full（子渲染器统一 h-full 自适应）。
//
// 内容源（PreviewSource）：既支持磁盘路径（走后端 API），也支持内存源（压缩包内层条目）。
// 取源集中在本组件，渲染器组件仅接收 buffer/text/objectUrl，故新增源类型不扩散。

import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { detectFileKind } from './detector';
import {
  fetchFileBuffer,
  fetchFileBufferCopy,
  fetchFileObjectUrl,
  fetchExtractedText,
  mimeOfPath,
  isNativeImageExt,
} from './fetcher';
import { decodeImageToObjectUrl } from '../image/decode';
import { extractArchiveEntryByPath } from '../archive/libarchive';
import { PreviewErrorBoundary } from '../core/PreviewErrorBoundary';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { pathSource, nameOfSource, extOfSource, type PreviewSource } from '../core/source';
import type { RendererKind } from '../core/types';

// ── 懒加载渲染器（每个自带 chunk） ────────────────────────────────────────────
const DocxPreview = lazy(() => import('../office/DocxPreview').then((m) => ({ default: m.DocxPreview })));
const SheetViewer = lazy(() => import('../office/ooxml-sheet/SheetViewer').then((m) => ({ default: m.SheetViewer })));
const SpreadsheetPreview = lazy(() => import('../office/SpreadsheetPreview').then((m) => ({ default: m.SpreadsheetPreview })));
const PptxRenderer = lazy(() => import('../office/PptxRenderer').then((m) => ({ default: m.PptxRenderer })));
const PdfPreview = lazy(() => import('../pdf/PdfPreview').then((m) => ({ default: m.PdfPreview })));
const Model3DViewer = lazy(() => import('../three-d/Model3DViewer').then((m) => ({ default: m.Model3DViewer })));
const ImageViewer = lazy(() => import('../image/ImageViewer').then((m) => ({ default: m.ImageViewer })));
const EpubViewer = lazy(() => import('../ebook/EpubViewer').then((m) => ({ default: m.EpubViewer })));
const VideoPlayer = lazy(() => import('../media/VideoPlayer').then((m) => ({ default: m.VideoPlayer })));
const AudioPlayer = lazy(() => import('../media/AudioPlayer').then((m) => ({ default: m.AudioPlayer })));
const FlvPlayer = lazy(() => import('../media/FlvPlayer').then((m) => ({ default: m.FlvPlayer })));
const HtmlPreview = lazy(() => import('../html/HtmlPreview').then((m) => ({ default: m.HtmlPreview })));
const CodeFileViewer = lazy(() => import('../code/CodeFileViewer').then((m) => ({ default: m.CodeFileViewer })));
const LatexPreview = lazy(() => import('../latex/LatexPreview').then((m) => ({ default: m.LatexPreview })));
const CsvPreview = lazy(() => import('../data/CsvPreview').then((m) => ({ default: m.CsvPreview })));
const NdjsonPreview = lazy(() => import('../data/NdjsonPreview').then((m) => ({ default: m.NdjsonPreview })));
const SqlitePreview = lazy(() => import('../data/SqlitePreview').then((m) => ({ default: m.SqlitePreview })));
const FontPreview = lazy(() => import('../font/FontPreview').then((m) => ({ default: m.FontPreview })));
const ArchivePane = lazy(() => import('../archive/ArchivePane').then((m) => ({ default: m.ArchivePane })));
const SubtitlePreview = lazy(() => import('../structured/SubtitlePreview').then((m) => ({ default: m.SubtitlePreview })));
const CalendarPreview = lazy(() => import('../structured/CalendarPreview').then((m) => ({ default: m.CalendarPreview })));
const ContactPreview = lazy(() => import('../structured/ContactPreview').then((m) => ({ default: m.ContactPreview })));
const GeoPreview = lazy(() => import('../structured/GeoPreview').then((m) => ({ default: m.GeoPreview })));
const CertificatePreview = lazy(() => import('../structured/CertificatePreview').then((m) => ({ default: m.CertificatePreview })));
const ColorProfilePreview = lazy(() => import('../structured/ColorProfilePreview').then((m) => ({ default: m.ColorProfilePreview })));
const DxfViewer = lazy(() => import('../cad/DxfViewer').then((m) => ({ default: m.DxfViewer })));
const SwfPreview = lazy(() => import('../flash/SwfPreview').then((m) => ({ default: m.SwfPreview })));
const FallbackPreview = lazy(() => import('../text/FallbackPreview').then((m) => ({ default: m.FallbackPreview })));

/** 需要拉取二进制缓冲的 kind（二进制类渲染器） */
const NEEDS_BUFFER: ReadonlySet<RendererKind> = new Set<RendererKind>([
  'office-docx',
  'office-xlsx',
  'office-pptx',
  'pdf',
  'ebook',
  'font',
  'archive',
  'sqlite',
  'certificate',
  'colorprofile',
  'flash',
]);

/** 文本类 kind：走 /api/filesystem/text（有界 8MB 读取 + UTF-8/GBK 编码检测 + NUL 二进制拒绝） */
const NEEDS_TEXT: ReadonlySet<RendererKind> = new Set<RendererKind>([
  'code',
  'markdown',
  'latex',
  'data',
  'html',
  'text',
  'subtitle',
  'calendar',
  'contact',
  'geo',
  'cad',
]);

/** Excel OOXML 家族（自写引擎 SheetViewer，保留样式）；其余（xls/xlsb/ods/xlt，及 OLE 版 WPS .et）走 SheetJS 兜底 */
const OOXML_SHEET_EXTS = new Set(['xlsx', 'xlsm', 'xltx', 'xltm']);

/** WPS 文字/演示扩展名：容器为 ZIP 时走原生渲染，为 OLE(旧版) 时直接走后端文本回退，避免抛错 */
const WPS_OLE_FALLBACK_EXTS = new Set(['wps', 'wpt', 'dps', 'dpt']);

/** 判断缓冲区是否为 OLE 复合文档（魔数 D0 CF 11 E0） */
function isOleBuffer(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false;
  const u = new Uint8Array(buf, 0, 4);
  return u[0] === 0xd0 && u[1] === 0xcf && u[2] === 0x11 && u[3] === 0xe0;
}

/** 判断缓冲区是否为 ZIP 容器（魔数 PK\x03\x04） */
function isZipBuffer(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false;
  const u = new Uint8Array(buf, 0, 4);
  return u[0] === 0x50 && u[1] === 0x4b && u[2] === 0x03 && u[3] === 0x04;
}

export interface FilePreviewPaneProps {
  /** 文件绝对路径（与 source 二选一；向后兼容） */
  path?: string;
  /** 内容源（优先于 path） */
  source?: PreviewSource;
  /** 是否激活（激活时才拉取内容）；弹层传 open，侧边栏标签传 true */
  active?: boolean;
  /** 预览区高度类；默认 h-full（侧边栏），弹层传 h-[calc(80dvh-9rem)] */
  heightClass?: string;
  /** 递归深度（压缩包内层预览防套娃，默认 0） */
  depth?: number;
  /** 所属会话 id（压缩包内层文件开新标签页所需；缺省时退回内嵌预览） */
  sessionId?: string;
}

function Loading({ heightClass }: { heightClass: string }) {
  const { t } = useTranslation();
  return (
    <div className={`flex ${heightClass} items-center justify-center text-muted-foreground`}>
      <Loader2 className="mr-2 size-5 animate-spin" />
      <span className="text-sm">{t('preview.loading')}</span>
    </div>
  );
}

function ErrorBox({ message, heightClass }: { message: string; heightClass: string }) {
  const { t } = useTranslation();
  return (
    <div className={`flex ${heightClass} flex-col items-center justify-center gap-2 px-4 text-center text-destructive`}>
      <TriangleAlert className="size-6" />
      <span className="text-sm">{t('preview.error')}</span>
      <span className="max-w-md break-all text-xs text-muted-foreground">{message}</span>
    </div>
  );
}

/** 纯文本回退（多级回退链的末端之一） */
function PlainText({ text, heightClass }: { text: string; heightClass: string }) {
  return (
    <pre className={`${heightClass} overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-xs text-foreground`}>
      {text}
    </pre>
  );
}

/** 内存字节 → 文本（UTF-8 优先，检测到替换字符则尝试 GBK） */
function decodeBytes(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(u8);
  if (utf8.includes('\uFFFD')) {
    try {
      const gbk = new TextDecoder('gbk', { fatal: false }).decode(u8);
      if (!gbk.includes('\uFFFD')) return gbk;
    } catch {
      // 浏览器不支持 gbk 时忽略
    }
  }
  return utf8;
}

/** 内容获取状态 */
interface FileContent {
  buffer: ArrayBuffer | null;
  objectUrl: string | null;
  text: string | null;
  /** 文本类内容被后端截断（超 maxChars / 有界读取上限） */
  truncated?: boolean;
  error: string | null;
}

const EMPTY_CONTENT: FileContent = { buffer: null, objectUrl: null, text: null, error: null };

export function FilePreviewPane({
  path,
  source,
  active = true,
  heightClass = 'h-full',
  depth = 0,
  sessionId,
}: FilePreviewPaneProps) {
  const { t } = useTranslation();
  // 源：显式 source 优先，否则由 path 构造（向后兼容 3 处既有调用）。
  // 必须 useMemo：否则每次渲染新建对象 → effect 依赖抖动 → 无限重复取内容。
  const src: PreviewSource = useMemo(() => source ?? pathSource(path ?? ''), [source, path]);
  const name = nameOfSource(src);
  const ext = extOfSource(src);
  const kind = detectFileKind(name);

  const [content, setContent] = useState<FileContent>(EMPTY_CONTENT);

  // 解码图片生成的 objectURL 需在卸载/切换时回收
  const decodedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setContent(EMPTY_CONTENT);

    const revokeDecoded = () => {
      if (decodedUrlRef.current) {
        URL.revokeObjectURL(decodedUrlRef.current);
        decodedUrlRef.current = null;
      }
    };

    void (async () => {
      try {
        // 本地字节 → 按 kind 直接分派（内存源与压缩包内层条目源共用）
        const applyLocal = async (bufIn: ArrayBuffer | null, directText: string | null, mime: string): Promise<void> => {
          if (kind === 'image') {
            if (bufIn === null) throw new Error('missing image bytes');
            if (isNativeImageExt(ext)) {
              const url = URL.createObjectURL(new Blob([bufIn], { type: mime }));
              decodedUrlRef.current = url;
              setContent({ ...EMPTY_CONTENT, objectUrl: url });
            } else {
              const url = await decodeImageToObjectUrl(bufIn, ext);
              if (cancelled) { URL.revokeObjectURL(url); return; }
              decodedUrlRef.current = url;
              setContent({ ...EMPTY_CONTENT, buffer: bufIn, objectUrl: url });
            }
            return;
          }
          if (kind === 'three-d' || kind === 'video' || kind === 'audio') {
            if (bufIn === null) throw new Error('missing media bytes');
            const url = URL.createObjectURL(new Blob([bufIn], { type: mime }));
            decodedUrlRef.current = url;
            setContent({ ...EMPTY_CONTENT, objectUrl: url });
            return;
          }
          if (NEEDS_TEXT.has(kind)) {
            const text = directText ?? (bufIn !== null ? decodeBytes(bufIn) : null);
            if (text === null) throw new Error('missing text content');
            setContent({ ...EMPTY_CONTENT, text });
            return;
          }
          if (NEEDS_BUFFER.has(kind)) {
            if (bufIn === null) throw new Error('missing bytes');
            // pdfjs 会把 buffer transfer 给 Worker（detach）→ 本地源同样传副本
            setContent({ ...EMPTY_CONTENT, buffer: kind === 'pdf' ? bufIn.slice(0) : bufIn });
            return;
          }
          setContent(EMPTY_CONTENT);
        };

        // ── 内存源：压缩包内层条目（内嵌预览）等，不走后端 ──
        if (src.kind === 'memory') {
          await applyLocal(src.buffer ?? null, src.text ?? null, src.mime ?? mimeOfPath(name));
          return;
        }

        // ── 压缩包内层条目源：按 外层路径 + 内层路径 提取字节（可持久化，刷新后自动恢复） ──
        if (src.kind === 'archive-entry') {
          const buf = await extractArchiveEntryByPath(src.archivePath, src.innerPath);
          if (cancelled) return;
          await applyLocal(buf, null, mimeOfPath(name));
          return;
        }

        // ── 磁盘源：走后端 API ──
        const filePath = src.path;
        // 图片（需解码）：TIFF/HEIC/netpbm/tga/jp2 → 二进制 → 解码 → objectURL
        if (kind === 'image' && !isNativeImageExt(ext)) {
          const buf = await fetchFileBuffer(filePath);
          if (cancelled) return;
          const url = await decodeImageToObjectUrl(buf, ext);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          decodedUrlRef.current = url;
          setContent({ ...EMPTY_CONTENT, buffer: buf, objectUrl: url });
          return;
        }
        // 图片（原生）/ 3D：objectURL
        if (kind === 'image' || kind === 'three-d') {
          const url = await fetchFileObjectUrl(filePath, mimeOfPath(filePath));
          if (!cancelled) setContent({ ...EMPTY_CONTENT, objectUrl: url });
          return;
        }
        // 文本类：走 /text（有界读取 + 编码检测），避免超大文本整块入内存、非 UTF-8 乱码
        if (NEEDS_TEXT.has(kind)) {
          const extracted = await fetchExtractedText(filePath);
          if (cancelled) return;
          setContent({ ...EMPTY_CONTENT, text: extracted.text, truncated: extracted.truncated });
          return;
        }
        // PDF：pdfjs 会把输入 buffer transfer 给 Worker（detach），必须传副本，
        //      否则 LRU 缓存中的原始 buffer 被 detach → 二次打开即崩溃
        if (kind === 'pdf') {
          const buf = await fetchFileBufferCopy(filePath);
          if (cancelled) return;
          setContent({ ...EMPTY_CONTENT, buffer: buf });
          return;
        }
        // 其余需要二进制
        if (NEEDS_BUFFER.has(kind)) {
          const buf = await fetchFileBuffer(filePath);
          if (cancelled) return;
          setContent({ ...EMPTY_CONTENT, buffer: buf });
          return;
        }
        // 视频/音频：直接使用后端 media 直链，无需预取
        setContent(EMPTY_CONTENT);
      } catch (err: unknown) {
        if (!cancelled) {
          setContent({ ...EMPTY_CONTENT, error: err instanceof Error ? err.message : String(err) });
        }
      }
    })();

    return () => {
      cancelled = true;
      revokeDecoded();
    };
  }, [active, src, kind, ext, name]);

  /** 用错误边界包裹（出错落到 fallback） */
  const guard = (node: ReactNode, fallback: ReactNode): ReactNode => (
    <PreviewErrorBoundary fallback={fallback} resetKey={name}>
      {node}
    </PreviewErrorBoundary>
  );

  /** 文本被后端截断时，在渲染器上方插入提示（内容过长，仅显示前 N 个字符） */
  const withTruncationNotice = (node: ReactNode): ReactNode =>
    content.truncated ? (
      <div className="flex h-full min-h-0 flex-col gap-1">
        <div className="shrink-0 rounded border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
          {t('preview.extractedTruncated', { chars: content.text?.length ?? 0 })}
        </div>
        <div className="min-h-0 flex-1">{node}</div>
      </div>
    ) : (
      node
    );

  const loading = <Loading heightClass={heightClass} />;
  const textFallback = content.text !== null ? <PlainText text={content.text} heightClass={heightClass} /> : loading;
  const genericFallback = guard(
    <FallbackPreview source={src} fileName={name} autoExtract={kind !== 'unknown'} />,
    <ErrorBox message={name} heightClass={heightClass} />,
  );

  const renderBody = (): ReactNode => {
    if (content.error !== null) return <ErrorBox message={content.error} heightClass={heightClass} />;

    switch (kind) {
      case 'office-docx':
        // WPS 文字旧版(OLE) → 无可用的前端渲染，直接走后端文本回退（避免 docx-preview 抛错）
        if (WPS_OLE_FALLBACK_EXTS.has(ext) && content.buffer && isOleBuffer(content.buffer)) return genericFallback;
        return guard(content.buffer ? <DocxPreview buffer={content.buffer} /> : loading, genericFallback);
      case 'office-xlsx': {
        const buf = content.buffer;
        if (!buf) return loading;
        // 自写 OOXML 引擎仅在确为 ZIP 容器时启用；其余（旧版/ODS/OLE 版 WPS .et）交给 SheetJS
        const useOwnEngine = OOXML_SHEET_EXTS.has(ext) && isZipBuffer(buf);
        return guard(
          useOwnEngine ? <SheetViewer buffer={buf} fileName={name} /> : <SpreadsheetPreview buffer={buf} ext={ext} fileName={name} />,
          genericFallback,
        );
      }
      case 'office-pptx':
        // WPS 演示旧版(OLE) → 直接走后端文本回退
        if (WPS_OLE_FALLBACK_EXTS.has(ext) && content.buffer && isOleBuffer(content.buffer)) return genericFallback;
        // PptxRenderer 内部已回退到文本大纲；此处再兜底到通用回退
        return guard(content.buffer ? <PptxRenderer buffer={content.buffer} /> : loading, genericFallback);
      case 'pdf':
        return guard(content.buffer ? <PdfPreview buffer={content.buffer} /> : loading, genericFallback);
      case 'ebook':
        // epub 走 epubjs；mobi/azw3/fb2 无前端渲染 → 文本回退
        return ext === 'epub'
          ? guard(content.buffer ? <EpubViewer buffer={content.buffer} /> : loading, genericFallback)
          : genericFallback;
      case 'video':
        return guard(
          ext === 'flv' ? (
            <FlvPlayer path={src.kind === 'path' ? src.path : undefined} objectUrl={content.objectUrl ?? undefined} />
          ) : (
            <VideoPlayer path={src.kind === 'path' ? src.path : undefined} objectUrl={content.objectUrl ?? undefined} ext={ext} />
          ),
          genericFallback,
        );
      case 'audio':
        return guard(
          <AudioPlayer path={src.kind === 'path' ? src.path : undefined} objectUrl={content.objectUrl ?? undefined} ext={ext} />,
          genericFallback,
        );
      case 'three-d':
        return guard(
          content.objectUrl ? <Model3DViewer url={content.objectUrl} ext={ext} /> : loading,
          genericFallback,
        );
      case 'image':
        return guard(
          content.objectUrl ? <ImageViewer url={content.objectUrl} alt={name} /> : loading,
          genericFallback,
        );
      case 'html':
        return guard(
          content.text !== null ? withTruncationNotice(<HtmlPreview text={content.text} path={name} />) : loading,
          textFallback,
        );
      case 'markdown':
        return guard(
          content.text !== null
            ? withTruncationNotice(
                <div className="h-full overflow-y-auto p-2">
                  <MarkdownRenderer text={content.text} streaming={false} />
                </div>,
              )
            : loading,
          textFallback,
        );
      case 'latex':
        return guard(
          content.text !== null ? withTruncationNotice(<LatexPreview text={content.text} path={name} />) : loading,
          textFallback,
        );
      case 'data':
        if (content.text === null) return loading;
        return guard(
          withTruncationNotice(
            ext === 'ndjson' || ext === 'jsonl' ? (
              <NdjsonPreview text={content.text} path={name} />
            ) : (
              <CsvPreview text={content.text} path={name} ext={ext} />
            ),
          ),
          textFallback,
        );
      case 'font':
        return guard(
          content.buffer ? <FontPreview buffer={content.buffer} ext={ext} fileName={name} /> : loading,
          genericFallback,
        );
      case 'archive':
        return guard(
          content.buffer ? (
            <ArchivePane
              buffer={content.buffer}
              ext={ext}
              fileName={name}
              depth={depth}
              archivePath={src.kind === 'path' ? src.path : undefined}
              sessionId={sessionId}
            />
          ) : loading,
          genericFallback,
        );
      case 'sqlite':
        return guard(
          content.buffer ? <SqlitePreview buffer={content.buffer} fileName={name} /> : loading,
          genericFallback,
        );
      case 'subtitle':
        return guard(
          content.text !== null ? <SubtitlePreview text={content.text} ext={ext} /> : loading,
          textFallback,
        );
      case 'calendar':
        return guard(
          content.text !== null ? <CalendarPreview text={content.text} /> : loading,
          textFallback,
        );
      case 'contact':
        return guard(
          content.text !== null ? <ContactPreview text={content.text} /> : loading,
          textFallback,
        );
      case 'geo':
        return guard(
          content.text !== null ? <GeoPreview text={content.text} ext={ext} /> : loading,
          textFallback,
        );
      case 'certificate':
        return guard(
          content.buffer ? <CertificatePreview buffer={content.buffer} ext={ext} /> : loading,
          genericFallback,
        );
      case 'colorprofile':
        return guard(
          content.buffer ? <ColorProfilePreview buffer={content.buffer} /> : loading,
          genericFallback,
        );
      case 'cad':
        return guard(
          content.text !== null ? <DxfViewer text={content.text} /> : loading,
          textFallback,
        );
      case 'flash':
        return guard(
          content.buffer ? <SwfPreview buffer={content.buffer} fileName={name} /> : loading,
          genericFallback,
        );
      case 'code':
      case 'text':
        return guard(
          content.text !== null ? withTruncationNotice(<CodeFileViewer text={content.text} path={name} />) : loading,
          textFallback,
        );
      case 'office-odf':
      case 'office-legacy':
        return genericFallback;
      default:
        return genericFallback;
    }
  };

  return (
    <div className={`${heightClass} flex min-h-0 flex-col overflow-hidden`}>
      <Suspense fallback={loading}>{renderBody()}</Suspense>
    </div>
  );
}