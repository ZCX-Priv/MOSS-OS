// render/pdf/PdfPreview.tsx
// PDF 预览（编辑器样式）：pdfjs-dist canvas 渲染 + 工具栏（页码/缩放/适应宽度/旋转/单页-连续）。
// 连续模式采用「按滚动窗口懒渲染」：仅渲染视口附近的页，长文档不卡、内存可控。
//
// detached 修复：pdfjs 会把输入 ArrayBuffer transfer 给 Worker 并 detach 它；
// 本组件始终传入 buffer 的副本（new Uint8Array(buffer.slice(0))），不污染 LRU 缓存/内存源。
//
// worker 经 vite `?url` 导入（标准姿势，无 CDN/内联）。本组件经 React.lazy 懒加载。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { DocumentToolbar } from '../office/DocumentToolbar';

export interface PdfPreviewProps {
  buffer: ArrayBuffer;
}

interface PdfViewport {
  width: number;
  height: number;
}
interface PdfRenderTask {
  promise: Promise<void>;
  cancel?: () => void;
}
interface PdfPageProxy {
  getViewport(opts: { scale: number; rotation?: number }): PdfViewport;
  render(opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): PdfRenderTask;
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPageProxy>;
  destroy?: () => Promise<void> | void;
}

/** pdfjs scale=1 约 72dpi；×1.5 接近常规阅读尺寸；zoom 为相对倍数 */
const BASE_SCALE = 1.5;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.15;
/** 连续模式的页间距与容器内边距（px） */
const GAP = 16;
const PAD = 24;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 单页画布：仅负责按 pageNumber/scale/rotation 渲染到 canvas（尺寸由该页自身 viewport 决定） */
function PdfCanvas({
  doc,
  pageNumber,
  scale,
  rotation,
}: {
  doc: PdfDoc;
  pageNumber: number;
  scale: number;
  rotation: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let task: PdfRenderTask | null = null;
    void (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale, rotation });
        const context = canvas.getContext('2d');
        if (!context) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        task = page.render({ canvasContext: context, viewport });
        await task.promise;
      } catch {
        // 渲染被取消（切换页/缩放）或失败：交由上层回退处理
      }
    })();
    return () => {
      cancelled = true;
      try {
        task?.cancel?.();
      } catch {
        // 忽略取消异常
      }
    };
  }, [doc, pageNumber, scale, rotation]);

  return <canvas ref={canvasRef} className="block rounded shadow-sm" />;
}

export function PdfPreview({ buffer }: PdfPreviewProps) {
  const { t } = useTranslation();
  const docRef = useRef<PdfDoc | null>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [continuous, setContinuous] = useState(true);
  const continuousRef = useRef(continuous);
  continuousRef.current = continuous;

  // 第 1 页在 scale=1/rotation=0 下的原始尺寸（用于估算页面尺寸与适应宽度）
  const [baseSize, setBaseSize] = useState<{ w: number; h: number } | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [viewportH, setViewportH] = useState(600);
  const [scrollTop, setScrollTop] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  /** 打开新文档后是否已完成一次「自动适应宽度」（每次 buffer 变化重置） */
  const autoFittedRef = useRef(false);

  // ── 加载文档（每次 buffer 变化重建；卸载/切换时销毁旧文档释放 worker） ──
  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError(null);
    setPage(1);
    setBaseSize(null);
    autoFittedRef.current = false;
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const loaded = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
        if (cancelled) {
          void (loaded as unknown as PdfDoc).destroy?.();
          return;
        }
        docRef.current = loaded as unknown as PdfDoc;
        setDoc(loaded as unknown as PdfDoc);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      const current = docRef.current;
      docRef.current = null;
      try {
        void current?.destroy?.();
      } catch {
        // 忽略销毁异常
      }
    };
  }, [buffer]);

  // ── 取第 1 页原始尺寸 ──
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    void (async () => {
      try {
        const p = await doc.getPage(1);
        if (cancelled) return;
        const vp = p.getViewport({ scale: 1, rotation: 0 });
        setBaseSize({ w: vp.width, h: vp.height });
      } catch {
        // 忽略：无 baseSize 时退化为固定缩放
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  // ── 容器尺寸监听（适应宽度 + 连续模式窗口计算） ──
  useEffect(() => {
    if (!doc) return;
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setContainerWidth(el.clientWidth);
      setViewportH(el.clientHeight);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [doc]);

  const onScroll = useCallback(() => {
    if (!continuousRef.current) return;
    const el = scrollRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  const scale = BASE_SCALE * zoom;

  // 页面显示尺寸（按第 1 页尺寸 + 当前旋转估算，作为占位/间距基准）
  const pageSize = useMemo(() => {
    if (!baseSize) return null;
    const rot90 = rotation % 180 !== 0;
    const w = (rot90 ? baseSize.h : baseSize.w) * scale;
    const h = (rot90 ? baseSize.w : baseSize.h) * scale;
    return { w, h };
  }, [baseSize, scale, rotation]);

  const step = (pageSize?.h ?? 1) + GAP;

  // 连续模式可视窗口（含前后缓冲页）
  const { windowStart, windowEnd } = useMemo(() => {
    if (!pageSize || !doc) return { windowStart: 1, windowEnd: 0 };
    const first = Math.floor(scrollTop / step) + 1;
    const last = Math.floor((scrollTop + viewportH) / step) + 1;
    return {
      windowStart: clamp(first - 1, 1, doc.numPages),
      windowEnd: clamp(last + 1, 1, doc.numPages),
    };
  }, [pageSize, doc, scrollTop, viewportH, step]);

  const visiblePages = useMemo(() => {
    const out: number[] = [];
    for (let n = windowStart; n <= windowEnd; n++) out.push(n);
    return out;
  }, [windowStart, windowEnd]);

  // 连续模式下由滚动位置推导「当前页」（用于工具栏显示）
  const visiblePage =
    continuous && pageSize && doc
      ? clamp(Math.floor((scrollTop + viewportH / 2) / step) + 1, 1, doc.numPages)
      : page;

  const goToPage = useCallback(
    (n: number) => {
      const max = doc?.numPages ?? 1;
      const target = clamp(Math.round(n), 1, max);
      setPage(target);
      if (continuousRef.current) {
        const el = scrollRef.current;
        if (el) el.scrollTop = (target - 1) * step;
      }
    },
    [doc, step],
  );

  const fitWidth = useCallback(() => {
    if (!baseSize || containerWidth <= 0) return;
    const rot90 = rotation % 180 !== 0;
    const baseW = rot90 ? baseSize.h : baseSize.w;
    const targetScale = (containerWidth - PAD) / baseW;
    setZoom(clamp(targetScale / BASE_SCALE, MIN_ZOOM, MAX_ZOOM));
  }, [baseSize, containerWidth, rotation]);

  // 打开文档后自动「适应宽度」一次（等首页尺寸与容器宽度都就绪后触发；每个 buffer 仅一次）
  useEffect(() => {
    if (!doc || !baseSize || containerWidth <= 0 || autoFittedRef.current) return;
    autoFittedRef.current = true;
    fitWidth();
  }, [doc, baseSize, containerWidth, fitWidth]);

  const toggleContinuous = useCallback(() => {
    setContinuous((c) => {
      const next = !c;
      // 切换后把当前页滚动到视口
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = next ? (page - 1) * step : 0;
      });
      return next;
    });
  }, [page, step]);

  const rotate = useCallback(() => setRotation((r) => (r + 90) % 360), []);

  if (error !== null) {
    return <div className="flex h-full items-center justify-center text-sm text-destructive">{error}</div>;
  }
  if (doc === null) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        <span className="text-sm">{t('preview.loading')}</span>
      </div>
    );
  }

  const spacerWidth = pageSize ? Math.max(containerWidth, pageSize.w + PAD) : containerWidth;
  // 连续模式依赖 baseSize 估算页高；若首页尺寸探测失败则退回单页渲染，避免空白
  const showContinuous = continuous && pageSize !== null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <DocumentToolbar
        zoom={zoom}
        onZoomIn={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
        onZoomOut={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
        onZoomReset={baseSize ? () => setZoom(1) : undefined}
        onFitWidth={fitWidth}
        page={visiblePage}
        pageCount={doc.numPages}
        onPageChange={goToPage}
        continuous={continuous}
        onToggleContinuous={toggleContinuous}
        onRotate={rotate}
      />

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto rounded border border-border bg-muted/30 p-3"
      >
        {showContinuous ? (
          <div className="relative mx-auto" style={{ width: spacerWidth || '100%', height: doc.numPages * step }}>
            {pageSize &&
              visiblePages.map((n) => (
                <div
                  key={n}
                  className="absolute left-1/2 -translate-x-1/2"
                  style={{ top: (n - 1) * step, minHeight: pageSize.h }}
                >
                  <PdfCanvas doc={doc} pageNumber={n} scale={scale} rotation={rotation} />
                </div>
              ))}
          </div>
        ) : (
          <div className="flex justify-center">
            <PdfCanvas doc={doc} pageNumber={clamp(page, 1, doc.numPages)} scale={scale} rotation={rotation} />
          </div>
        )}
      </div>
    </div>
  );
}