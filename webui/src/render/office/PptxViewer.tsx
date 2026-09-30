// render/office/PptxViewer.tsx
// PowerPoint (.pptx) 高保真分页渲染：pptx-react-viewer 将每页渲染为 HTML/SVG DOM
// （非 canvas，文字可选中/缩放清晰），内置缩略图/翻页/备注。
// 懒加载；解析或渲染失败 → 回退 PptxOutline（文本大纲）。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { lazy, useEffect, useState, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
// 库自带样式表（本地打包，非 CDN）；随本懒加载 chunk 一同加载
import 'pptx-react-viewer/styles';
import { PptxOutline } from './PptxOutline';
import { PreviewErrorBoundary } from '../core/PreviewErrorBoundary';

// 按需加载（pptx-react-viewer 体积大，避免进首屏主 chunk）
const PowerPointViewer = lazy(() =>
  import('pptx-react-viewer').then((m) => ({ default: m.PowerPointViewer })),
);

export interface PptxViewerProps {
  buffer: ArrayBuffer;
}

function Loading() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {t('preview.loading')}
    </div>
  );
}

export function PptxViewer({ buffer }: PptxViewerProps) {
  const { t } = useTranslation();
  const [bytes, setBytes] = useState<Uint8Array | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 拷贝为 Uint8Array（库要求 content 为 Uint8Array）
    const arr = new Uint8Array(buffer);
    if (!cancelled) setBytes(arr);
    return () => {
      cancelled = true;
    };
  }, [buffer]);

  // 回退链：高保真渲染器抛错 → 文本大纲
  const fallback = (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {t('preview.pptxDegraded')}
      </div>
      <div className="min-h-0 flex-1">
        <PptxOutline buffer={buffer} />
      </div>
    </div>
  );

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <PreviewErrorBoundary fallback={fallback} resetKey={String(buffer.byteLength)}>
        {bytes === null ? (
          <Loading />
        ) : (
          <Suspense fallback={<Loading />}>
            <PowerPointViewer
              content={bytes}
              canEdit={false}
              // 预览场景隐藏分享/直播/录制等非预览操作
              hiddenActions={['share', 'broadcast', 'record']}
            />
          </Suspense>
        )}
      </PreviewErrorBoundary>
    </div>
  );
}