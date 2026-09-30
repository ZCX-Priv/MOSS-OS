// render/file/FilePreviewPane.tsx
// 文件预览面板：按 RendererKind 懒加载分发渲染器（打开/激活时才加载对应引擎 chunk）。
// 每一级渲染器均包 PreviewErrorBoundary，出错自动落到「回退链」下一级，最终落到 FallbackPreview。
// 高度由 heightClass 决定：弹层传固定高度，侧边栏默认 h-full（子渲染器统一 h-full 自适应）。

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { detectFileKind, fileNameOf, fileExtension } from './detector';
import {
  fetchFileBuffer,
  fetchFileObjectUrl,
  mimeOfPath,
  isNativeImageExt,
} from './fetcher';
import { decodeImageToObjectUrl } from '../image/decode';
import { PreviewErrorBoundary } from '../core/PreviewErrorBoundary';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import type { RendererKind } from '../core/types';

// ── 懒加载渲染器（每个自带 chunk） ────────────────────────────────────────────
const DocxPreview = lazy(() => import('../office/DocxPreview').then((m) => ({ default: m.DocxPreview })));
const XlsxPreview = lazy(() => import('../office/XlsxPreview').then((m) => ({ default: m.XlsxPreview })));
const PptxViewer = lazy(() => import('../office/PptxViewer').then((m) => ({ default: m.PptxViewer })));
const PdfPreview = lazy(() => import('../pdf/PdfPreview').then((m) => ({ default: m.PdfPreview })));
const Model3DViewer = lazy(() => import('../three-d/Model3DViewer').then((m) => ({ default: m.Model3DViewer })));
const EpubViewer = lazy(() => import('../ebook/EpubViewer').then((m) => ({ default: m.EpubViewer })));
const VideoPlayer = lazy(() => import('../media/VideoPlayer').then((m) => ({ default: m.VideoPlayer })));
const AudioPlayer = lazy(() => import('../media/AudioPlayer').then((m) => ({ default: m.AudioPlayer })));
const HtmlPreview = lazy(() => import('../html/HtmlPreview').then((m) => ({ default: m.HtmlPreview })));
const CodeFileViewer = lazy(() => import('../code/CodeFileViewer').then((m) => ({ default: m.CodeFileViewer })));
const CsvPreview = lazy(() => import('../data/CsvPreview').then((m) => ({ default: m.CsvPreview })));
const FontPreview = lazy(() => import('../font/FontPreview').then((m) => ({ default: m.FontPreview })));
const ArchivePreview = lazy(() => import('../archive/ArchivePreview').then((m) => ({ default: m.ArchivePreview })));
const FallbackPreview = lazy(() => import('../text/FallbackPreview').then((m) => ({ default: m.FallbackPreview })));

/** 需要拉取二进制缓冲的 kind */
const NEEDS_BUFFER: ReadonlySet<RendererKind> = new Set<RendererKind>([
  'office-docx',
  'office-xlsx',
  'office-pptx',
  'pdf',
  'ebook',
  'font',
  'archive',
  'code',
  'markdown',
  'data',
  'html',
  'text',
]);

/** 需要将缓冲解码为文本的 kind */
const NEEDS_TEXT: ReadonlySet<RendererKind> = new Set<RendererKind>([
  'code',
  'markdown',
  'data',
  'html',
  'text',
]);

export interface FilePreviewPaneProps {
  /** 文件绝对路径 */
  path: string;
  /** 是否激活（激活时才拉取内容）；弹层传 open，侧边栏标签传 true */
  active?: boolean;
  /** 预览区高度类；默认 h-full（侧边栏），弹层传 h-[calc(80dvh-9rem)] */
  heightClass?: string;
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

/** 内容获取状态 */
interface FileContent {
  buffer: ArrayBuffer | null;
  objectUrl: string | null;
  text: string | null;
  error: string | null;
}

export function FilePreviewPane({ path, active = true, heightClass = 'h-full' }: FilePreviewPaneProps) {
  const kind = detectFileKind(path);
  const ext = fileExtension(path);
  const name = fileNameOf(path);

  const [content, setContent] = useState<FileContent>({
    buffer: null,
    objectUrl: null,
    text: null,
    error: null,
  });

  // 解码图片（TIFF/HEIC）生成的 objectURL 需在卸载/切换时回收
  const decodedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setContent({ buffer: null, objectUrl: null, text: null, error: null });

    const revokeDecoded = () => {
      if (decodedUrlRef.current) {
        URL.revokeObjectURL(decodedUrlRef.current);
        decodedUrlRef.current = null;
      }
    };

    void (async () => {
      try {
        // 图片（需解码）：TIFF/HEIC → 二进制 → 解码 → objectURL
        if (kind === 'image' && !isNativeImageExt(ext)) {
          const buf = await fetchFileBuffer(path);
          if (cancelled) return;
          const url = await decodeImageToObjectUrl(buf, ext);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          decodedUrlRef.current = url;
          setContent({ buffer: buf, objectUrl: url, text: null, error: null });
          return;
        }
        // 图片（原生）/ 3D：objectURL
        if (kind === 'image' || kind === 'three-d') {
          const url = await fetchFileObjectUrl(path, mimeOfPath(path));
          if (!cancelled) setContent({ buffer: null, objectUrl: url, text: null, error: null });
          return;
        }
        // 其余需要二进制
        if (NEEDS_BUFFER.has(kind)) {
          const buf = await fetchFileBuffer(path);
          if (cancelled) return;
          const text = NEEDS_TEXT.has(kind) ? new TextDecoder('utf-8').decode(buf) : null;
          setContent({ buffer: buf, objectUrl: null, text, error: null });
          return;
        }
        // 视频/音频：直接使用后端 media 直链，无需预取
        setContent({ buffer: null, objectUrl: null, text: null, error: null });
      } catch (err: unknown) {
        if (!cancelled) {
          setContent({
            buffer: null,
            objectUrl: null,
            text: null,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      revokeDecoded();
    };
  }, [active, path, kind, ext]);

  /** 用错误边界包裹（出错落到 fallback） */
  const guard = (node: ReactNode, fallback: ReactNode): ReactNode => (
    <PreviewErrorBoundary fallback={fallback} resetKey={path}>
      {node}
    </PreviewErrorBoundary>
  );

  const loading = <Loading heightClass={heightClass} />;
  const textFallback = content.text !== null ? <PlainText text={content.text} heightClass={heightClass} /> : loading;
  const genericFallback = guard(
    <FallbackPreview
      path={path}
      fileName={name}
      autoExtract={kind !== 'unknown'}
    />,
    <ErrorBox message={name} heightClass={heightClass} />,
  );

  const renderBody = (): ReactNode => {
    if (content.error !== null) return <ErrorBox message={content.error} heightClass={heightClass} />;

    switch (kind) {
      case 'office-docx':
        return guard(content.buffer ? <DocxPreview buffer={content.buffer} /> : loading, genericFallback);
      case 'office-xlsx':
        return guard(content.buffer ? <XlsxPreview buffer={content.buffer} /> : loading, genericFallback);
      case 'office-pptx':
        // PptxViewer 内部已回退到文本大纲；此处再兜底到通用回退
        return guard(content.buffer ? <PptxViewer buffer={content.buffer} /> : loading, genericFallback);
      case 'pdf':
        return guard(content.buffer ? <PdfPreview buffer={content.buffer} /> : loading, genericFallback);
      case 'ebook':
        // epub 走 epubjs；mobi/azw3/fb2 无前端渲染 → 文本回退
        return ext === 'epub'
          ? guard(content.buffer ? <EpubViewer buffer={content.buffer} /> : loading, genericFallback)
          : genericFallback;
      case 'video':
        return guard(<VideoPlayer path={path} ext={ext} />, genericFallback);
      case 'audio':
        return guard(<AudioPlayer path={path} ext={ext} />, genericFallback);
      case 'three-d':
        return guard(
          content.objectUrl ? <Model3DViewer url={content.objectUrl} ext={ext} /> : loading,
          genericFallback,
        );
      case 'image':
        return guard(
          content.objectUrl ? (
            <div className="flex h-full items-center justify-center overflow-hidden">
              <img src={content.objectUrl} alt={name} className="max-h-full max-w-full rounded object-contain" />
            </div>
          ) : (
            loading
          ),
          genericFallback,
        );
      case 'html':
        return guard(
          content.text !== null ? <HtmlPreview text={content.text} path={path} /> : loading,
          textFallback,
        );
      case 'markdown':
        return guard(
          content.text !== null ? (
            <div className="h-full overflow-y-auto p-2">
              <MarkdownRenderer text={content.text} streaming={false} />
            </div>
          ) : (
            loading
          ),
          textFallback,
        );
      case 'data':
        return guard(
          content.text !== null ? <CsvPreview text={content.text} path={path} ext={ext} /> : loading,
          textFallback,
        );
      case 'font':
        return guard(
          content.buffer ? <FontPreview buffer={content.buffer} ext={ext} fileName={name} /> : loading,
          genericFallback,
        );
      case 'archive':
        return guard(
          content.buffer ? <ArchivePreview buffer={content.buffer} ext={ext} fileName={name} /> : loading,
          genericFallback,
        );
      case 'code':
      case 'text':
        return guard(
          content.text !== null ? <CodeFileViewer text={content.text} path={path} /> : loading,
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