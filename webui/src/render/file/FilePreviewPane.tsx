// render/file/FilePreviewPane.tsx
// 文件预览面板：按 RendererKind 懒加载分发渲染器（打开/激活时才加载对应引擎 chunk）。
// docx→DocxPreview / xlsx→XlsxPreview / pptx→PptxOutline / pdf→PdfPreview /
// 3D→Model3DViewer / image→大图 / text→Markdown 或纯文本。
// 高度由 heightClass 决定：弹层传固定高度，侧边栏默认 h-full（子渲染器统一 h-full 自适应）。

import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import { detectFileKind, fileNameOf, fileExtension } from './detector';
import { fetchFileBuffer, fetchFileObjectUrl, mimeOfPath } from './fetcher';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';

const DocxPreview = lazy(() => import('../office/DocxPreview').then((m) => ({ default: m.DocxPreview })));
const XlsxPreview = lazy(() => import('../office/XlsxPreview').then((m) => ({ default: m.XlsxPreview })));
const PptxOutline = lazy(() => import('../office/PptxOutline').then((m) => ({ default: m.PptxOutline })));
const PdfPreview = lazy(() => import('../pdf/PdfPreview').then((m) => ({ default: m.PdfPreview })));
const Model3DViewer = lazy(() => import('../three-d/Model3DViewer').then((m) => ({ default: m.Model3DViewer })));

export interface FilePreviewPaneProps {
  /** 文件绝对路径 */
  path: string;
  /** 是否激活（激活时才拉取内容）；弹层传 open，侧边栏标签传 true */
  active?: boolean;
  /** 预览区高度类；默认 h-full（侧边栏），弹层传 h-[calc(80dvh-9rem)] */
  heightClass?: string;
}

function Loading({ heightClass }: { heightClass: string }) {
  return (
    <div className={`flex ${heightClass} items-center justify-center text-muted-foreground`}>
      <Loader2 className="mr-2 size-5 animate-spin" />
      <span className="text-sm">Loading…</span>
    </div>
  );
}

function ErrorBox({ message, heightClass }: { message: string; heightClass: string }) {
  return (
    <div className={`flex ${heightClass} flex-col items-center justify-center gap-2 text-destructive`}>
      <TriangleAlert className="size-6" />
      <span className="text-sm">{message}</span>
    </div>
  );
}

export function FilePreviewPane({ path, active = true, heightClass = 'h-full' }: FilePreviewPaneProps) {
  const kind = detectFileKind(path);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setError(null);
    setBuffer(null);
    setObjectUrl(null);
    setText(null);
    if (kind === 'image' || kind === 'three-d') {
      void fetchFileObjectUrl(path, mimeOfPath(path))
        .then((url) => {
          if (!cancelled) setObjectUrl(url);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        });
    } else if (kind === 'text') {
      void fetchFileBuffer(path)
        .then((buf) => {
          if (cancelled) return;
          setBuffer(buf);
          setText(new TextDecoder('utf-8').decode(buf));
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        });
    } else {
      void fetchFileBuffer(path)
        .then((buf) => {
          if (!cancelled) setBuffer(buf);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [active, path, kind]);

  const renderBody = (): ReactNode => {
    if (error !== null) return <ErrorBox message={error} heightClass={heightClass} />;
    switch (kind) {
      case 'office-docx':
        return buffer ? <DocxPreview buffer={buffer} /> : <Loading heightClass={heightClass} />;
      case 'office-xlsx':
        return buffer ? <XlsxPreview buffer={buffer} /> : <Loading heightClass={heightClass} />;
      case 'office-pptx':
        return buffer ? <PptxOutline buffer={buffer} /> : <Loading heightClass={heightClass} />;
      case 'pdf':
        return buffer ? <PdfPreview buffer={buffer} /> : <Loading heightClass={heightClass} />;
      case 'three-d':
        return objectUrl ? <Model3DViewer url={objectUrl} ext={fileExtension(path)} /> : <Loading heightClass={heightClass} />;
      case 'image':
        return objectUrl ? (
          <div className="flex h-full items-center justify-center overflow-hidden">
            <img src={objectUrl} alt={fileNameOf(path)} className="max-h-full max-w-full rounded object-contain" />
          </div>
        ) : (
          <Loading heightClass={heightClass} />
        );
      case 'text':
        return text !== null ? (
          fileExtension(path) === 'md' ? (
            <div className="h-full overflow-y-auto p-2">
              <MarkdownRenderer text={text} streaming={false} />
            </div>
          ) : (
            <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-xs text-foreground">
              {text}
            </pre>
          )
        ) : (
          <Loading heightClass={heightClass} />
        );
      default:
        return <ErrorBox message="Unsupported preview type" heightClass={heightClass} />;
    }
  };

  return (
    <div className={`${heightClass} flex min-h-0 flex-col overflow-hidden`}>
      <Suspense fallback={<Loading heightClass={heightClass} />}>{renderBody()}</Suspense>
    </div>
  );
}