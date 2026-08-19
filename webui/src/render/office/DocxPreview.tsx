// render/office/DocxPreview.tsx
// Word (.docx) 预览：docx-preview renderAsync 渲染到容器（语义化 HTML，保真度高）。
// 本组件经 React.lazy 懒加载（FilePreviewDialog 分发）。

import { useEffect, useRef } from 'react';

export interface DocxPreviewProps {
  buffer: ArrayBuffer;
}

export function DocxPreview({ buffer }: DocxPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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
    <div className="max-h-[75vh] overflow-auto rounded border border-border bg-background p-2">
      <div ref={containerRef} className="docx-container" />
    </div>
  );
}
