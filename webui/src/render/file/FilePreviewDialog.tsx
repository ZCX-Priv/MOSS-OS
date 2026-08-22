// render/file/FilePreviewDialog.tsx
// 全屏文件预览弹层：按 RendererKind 懒加载分发渲染器（打开时才加载对应引擎 chunk）。
// docx→DocxPreview / xlsx→XlsxPreview / pptx→PptxOutline / pdf→PdfPreview /
// 3D→Model3DViewer / image→大图 / text→Markdown 或纯文本。

import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { detectFileKind, fileNameOf, fileExtension } from './detector';
import { fetchFileBuffer, fetchFileObjectUrl, mimeOfPath } from './fetcher';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';

const DocxPreview = lazy(() => import('../office/DocxPreview').then((m) => ({ default: m.DocxPreview })));
const XlsxPreview = lazy(() => import('../office/XlsxPreview').then((m) => ({ default: m.XlsxPreview })));
const PptxOutline = lazy(() => import('../office/PptxOutline').then((m) => ({ default: m.PptxOutline })));
const PdfPreview = lazy(() => import('../pdf/PdfPreview').then((m) => ({ default: m.PdfPreview })));
const Model3DViewer = lazy(() => import('../three-d/Model3DViewer').then((m) => ({ default: m.Model3DViewer })));

export interface FilePreviewDialogProps {
  path: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Loading() {
  return (
    <div className="flex h-[calc(80dvh-9rem)] items-center justify-center text-muted-foreground">
      <Loader2 className="mr-2 size-5 animate-spin" />
      <span className="text-sm">Loading…</span>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex h-[calc(80dvh-9rem)] flex-col items-center justify-center gap-2 text-destructive">
      <TriangleAlert className="size-6" />
      <span className="text-sm">{message}</span>
    </div>
  );
}

export function FilePreviewDialog({ path, open, onOpenChange }: FilePreviewDialogProps) {
  const kind = detectFileKind(path);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
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
  }, [open, path, kind]);

  const renderBody = (): ReactNode => {
    if (error !== null) return <ErrorBox message={error} />;
    switch (kind) {
      case 'office-docx':
        return buffer ? <DocxPreview buffer={buffer} /> : <Loading />;
      case 'office-xlsx':
        return buffer ? <XlsxPreview buffer={buffer} /> : <Loading />;
      case 'office-pptx':
        return buffer ? <PptxOutline buffer={buffer} /> : <Loading />;
      case 'pdf':
        return buffer ? <PdfPreview buffer={buffer} /> : <Loading />;
      case 'three-d':
        return objectUrl ? <Model3DViewer url={objectUrl} ext={fileExtension(path)} /> : <Loading />;
      case 'image':
        return objectUrl ? (
          <div className="flex max-h-[calc(80dvh-9rem)] items-center justify-center">
            <img src={objectUrl} alt={fileNameOf(path)} className="max-h-[calc(80dvh-9rem)] max-w-full rounded object-contain" />
          </div>
        ) : (
          <Loading />
        );
      case 'text':
        return text !== null ? (
          fileExtension(path) === 'md' ? (
            <div className="max-h-[calc(80dvh-9rem)] overflow-y-auto p-2">
              <MarkdownRenderer text={text} streaming={false} />
            </div>
          ) : (
            <pre className="max-h-[calc(80dvh-9rem)] overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-xs text-foreground">
              {text}
            </pre>
          )
        ) : (
          <Loading />
        );
      default:
        return <ErrorBox message="Unsupported preview type" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="overflow-hidden">
        <DialogHeader>
          <DialogTitle className="truncate pr-6 font-mono text-sm" title={path}>
            {fileNameOf(path)}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-hidden">
          <Suspense fallback={<Loading />}>{renderBody()}</Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
}
