// render/office/PptxRenderer.tsx
// PowerPoint (.pptx) 高保真分页渲染（纯渲染器，非编辑器）。
//
// 选型与约束（重要，勿改）：
// 1. 使用 @aiden0z/pptx-renderer —— 纯渲染库，**不附带任何样式表**、不向 document.body 挂载可见浮层。
//    历史教训：曾用编辑器级库（pptx-react-viewer），其 `styles` 是全文档级 Tailwind preflight +
//    `:root` 主题变量，注入后污染整站配色/字体，且体量（4.9MB+4.6MB）导致内存耗尽、卡死、PWA 崩溃。
// 2. 因此本文件**禁止** import 任何第三方样式表；容器由本组件自持（不 portal、不挂 body）。
// 3. 所有跨库 props 必须为稳定引用（禁止内联数组/对象字面量），避免 effect 依赖抖动引发循环渲染
//    —— 旧实现对不稳定 `hiddenActions={[...]}` 的教训。
//
// 回退链：PptxRenderer 失败 → PptxOutline（文本大纲）→ FilePreviewPane 级通用回退。

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PreviewErrorBoundary } from '../core/PreviewErrorBoundary';
import { DocumentToolbar } from './DocumentToolbar';
import { PptxOutline } from './PptxOutline';

/** 渲染器实例的最小结构约束（避免 any） */
interface PptxViewerHandle {
  destroy(): void;
}

export interface PptxRendererProps {
  buffer: ArrayBuffer;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;

export function PptxRenderer({ buffer }: PptxRendererProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let viewer: PptxViewerHandle | null = null;

    void (async () => {
      try {
        // 按需懒加载（渲染引擎体积较大，不进首屏）
        const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import('@aiden0z/pptx-renderer');
        if (cancelled) return;
        host.innerHTML = '';
        const v = await PptxViewer.open(buffer, host, {
          zipLimits: RECOMMENDED_ZIP_LIMITS,
          // 懒解析 + 窗口化挂载：避免一次性构建/挂载全部页导致卡死
          lazySlides: true,
          lazyMedia: true,
          renderMode: 'list',
          listOptions: { windowed: true, initialSlides: 3, batchSize: 3 },
        });
        if (cancelled) {
          v.destroy();
          return;
        }
        viewer = v;
      } catch {
        // 解析/渲染失败 → 回退文本大纲
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      try {
        viewer?.destroy();
      } catch {
        // destroy 失败不影响卸载
      }
      viewer = null;
      if (host) host.innerHTML = '';
    };
  }, [buffer]);

  const degraded = (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {t('preview.pptxDegraded')}
      </div>
      <div className="min-h-0 flex-1">
        <PptxOutline buffer={buffer} />
      </div>
    </div>
  );

  if (failed) return degraded;

  return (
    <PreviewErrorBoundary fallback={degraded} resetKey={String(buffer.byteLength)}>
      <div className="grid h-full min-h-0 grid-rows-[auto_1fr] gap-2">
        <DocumentToolbar
          zoom={zoom}
          onZoomIn={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
          onZoomOut={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
          onZoomReset={() => setZoom(1)}
        />
        <div ref={hostRef} className="pptx-viewer-host min-h-0 w-full overflow-auto" style={{ zoom }} />
      </div>
    </PreviewErrorBoundary>
  );
}