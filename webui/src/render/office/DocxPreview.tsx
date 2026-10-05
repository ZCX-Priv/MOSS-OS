// render/office/DocxPreview.tsx
// Word (.docx) 预览（编辑器样式）：docx-preview renderAsync 渲染到容器（语义化 HTML，保真度高）
// + 顶部 DocumentToolbar（缩放 −/+/重置）。缩放用 CSS `zoom`（重排布局，滚动条范围随之正确）。
// 纸张观感（白纸 + 阴影 + 页间距）由 docx-preview 的 page 样式提供。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useEffect, useRef, useState } from 'react';
import { DocumentToolbar } from './DocumentToolbar';

export interface DocxPreviewProps {
  buffer: ArrayBuffer;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;

export function DocxPreview({ buffer }: DocxPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    void (async () => {
      const { renderAsync } = await import('docx-preview');
      if (cancelled || !containerRef.current) return;
      container.innerHTML = '';
      await renderAsync(new Blob([buffer]), container, undefined, {
        className: 'docx-render',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [buffer]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <DocumentToolbar
        zoom={zoom}
        onZoomIn={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
        onZoomOut={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
        onZoomReset={() => setZoom(1)}
      />
      <div className="min-h-0 flex-1 overflow-auto rounded border border-border bg-muted/40 p-3">
        <div ref={containerRef} className="docx-container" style={{ zoom }} />
      </div>
    </div>
  );
}