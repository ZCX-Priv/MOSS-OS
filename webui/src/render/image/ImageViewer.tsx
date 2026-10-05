// render/image/ImageViewer.tsx
// 图片查看器（自研，单 <img>）：缩放（滚轮/按钮，滚轮以光标为锚点）/ 拖拽平移 / 旋转 / 重置。
// 不使用任何第三方查看器库：Viewer.js 的 inline 模式会在宿主内再插入自身的 viewer 容器并搬运原图，
// 与宿主布局叠加导致「同一张图两份错位重叠」，且 inline 下单击即进入全屏模态（配置无法关闭）。
// 本组件只渲染唯一一个 <img>，不向 document.body 挂载节点，不提供全屏/模态能力。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';

export interface ImageViewerProps {
  /** 图片可显示 URL（原生解码或自解码后的 objectURL） */
  url: string;
  alt: string;
}

/** 缩放范围 */
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
/** 单次按钮缩放步进 */
const STEP = 1.25;

interface ViewState {
  scale: number;
  /** 旋转角度（度） */
  rotation: number;
  /** 相对宿主的平移（屏幕像素） */
  x: number;
  y: number;
}

const INITIAL_VIEW: ViewState = { scale: 1, rotation: 0, x: 0, y: 0 };

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

const TOOL_BTN =
  'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';

export function ImageViewer({ url, alt }: ImageViewerProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // 切换图片 → 重置视图
  useEffect(() => {
    setView(INITIAL_VIEW);
  }, [url]);

  // 滚轮缩放：以光标为锚点。必须用原生非被动监听（React 的 onWheel 无法 preventDefault）
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const cx = event.clientX - rect.left - rect.width / 2;
      const cy = event.clientY - rect.top - rect.height / 2;
      setView((v) => {
        const scale = clamp(v.scale * Math.exp(-event.deltaY * 0.0015), MIN_SCALE, MAX_SCALE);
        const k = scale / v.scale;
        // 使光标下的图像点保持不动：(offset - c) * k + c
        return { ...v, scale, x: (v.x - cx) * k + cx, y: (v.y - cy) * k + cy };
      });
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setView((v) => ({ ...v, scale: clamp(v.scale * factor, MIN_SCALE, MAX_SCALE) }));
  }, []);

  const rotateBy = useCallback((deg: number) => {
    setView((v) => ({ ...v, rotation: (v.rotation + deg) % 360 }));
  }, []);

  const reset = useCallback(() => setView(INITIAL_VIEW), []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y };
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setView((v) => ({ ...v, x: drag.ox + (event.clientX - drag.x), y: drag.oy + (event.clientY - drag.y) }));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={hostRef}
      className="image-viewer-host relative h-full w-full overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <img
        src={url}
        alt={alt}
        draggable={false}
        className="absolute left-1/2 top-1/2 max-h-full max-w-full select-none object-contain"
        style={{
          transform: `translate3d(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px), 0) scale(${view.scale}) rotate(${view.rotation}deg)`,
          transition: dragging ? 'none' : 'transform 120ms ease-out',
          cursor: dragging ? 'grabbing' : 'grab',
        }}
      />

      {/* 底部悬浮工具条（无全屏） */}
      <div
        className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-md border border-border/60 bg-background/85 px-1 py-0.5 backdrop-blur-sm"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button type="button" className={TOOL_BTN} onClick={() => zoomBy(1 / STEP)} title={t('preview.zoomOut')} aria-label={t('preview.zoomOut')}>
          <ZoomOut className="size-4" />
        </button>
        <button
          type="button"
          onClick={reset}
          title={t('preview.zoomReset')}
          aria-label={t('preview.zoomReset')}
          className="min-w-12 rounded-md px-1 text-center font-mono text-xs tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {Math.round(view.scale * 100)}%
        </button>
        <button type="button" className={TOOL_BTN} onClick={() => zoomBy(STEP)} title={t('preview.zoomIn')} aria-label={t('preview.zoomIn')}>
          <ZoomIn className="size-4" />
        </button>
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
        <button type="button" className={TOOL_BTN} onClick={() => rotateBy(-90)} title={t('preview.rotate')} aria-label={t('preview.rotate')}>
          <RotateCcw className="size-4" />
        </button>
        <button type="button" className={TOOL_BTN} onClick={() => rotateBy(90)} title={t('preview.rotate')} aria-label={t('preview.rotate')}>
          <RotateCw className="size-4" />
        </button>
      </div>
    </div>
  );
}