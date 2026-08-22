// render/pdf/PdfPreview.tsx
// PDF 预览：pdfjs-dist canvas 渲染 + 分页 + 缩放。
// worker 经 vite `?url` 导入（标准姿势，无 CDN/内联）。懒加载（FilePreviewDialog 分发）。

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export interface PdfPreviewProps {
  buffer: ArrayBuffer;
}

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getViewport: (opts: { scale: number }) => { width: number; height: number };
    render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
  }>;
};

const ZOOM_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;

export function PdfPreview({ buffer }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);

  // 加载文档
  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError(null);
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const loaded = await pdfjs.getDocument({ data: buffer }).promise;
        if (!cancelled) {
          setDoc(loaded as unknown as PdfDoc);
          setPage(1);
        }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buffer]);

  // 渲染当前页
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return;
    let cancelled = false;
    void (async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: zoom * 1.5 });
      const context = canvas.getContext('2d');
      if (!context) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await pdfPage.render({ canvasContext: context, viewport }).promise;
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, page, zoom]);

  if (error !== null) {
    return <div className="flex h-[calc(80dvh-9rem)] items-center justify-center text-sm text-destructive">{error}</div>;
  }
  if (doc === null) {
    return <div className="flex h-[calc(80dvh-9rem)] items-center justify-center text-sm text-muted-foreground">Loading PDF…</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label="previous page"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-16 text-center font-mono text-xs text-foreground">
            {page} / {doc.numPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={page >= doc.numPages}
            onClick={() => setPage((p) => Math.min(doc.numPages, p + 1))}
            aria-label="next page"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <Select
          value={String(zoom)}
          onValueChange={(v) => setZoom(Number(v))}
        >
          <SelectTrigger className="h-7 w-24 text-xs" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ZOOM_OPTIONS.map((z) => (
              <SelectItem key={z} value={String(z)} className="text-xs">
                {Math.round(z * 100)}%
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="max-h-[calc(80dvh-9rem)] overflow-auto rounded border border-border bg-muted/30 p-3">
        <canvas ref={canvasRef} className="mx-auto block max-w-full rounded shadow-sm" />
      </div>
    </div>
  );
}
