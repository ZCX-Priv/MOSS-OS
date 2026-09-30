// render/media/VideoPlayer.tsx
// 视频播放：后端 /api/filesystem/media 直链（支持 HTTP Range，可拖动进度、省内存）。
// 浏览器不支持的容器/编码（如 mkv/avi/wmv）→ 回退提示 + 下载。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, TriangleAlert } from 'lucide-react';
import { buildMediaUrl, isNativeVideoExt } from '../file/fetcher';

export interface VideoPlayerProps {
  path: string;
  ext: string;
}

export function VideoPlayer({ path, ext }: VideoPlayerProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const src = buildMediaUrl(path);

  if (!isNativeVideoExt(ext) || failed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <TriangleAlert className="size-6" />
        <div className="max-w-md text-center text-sm">{t('preview.mediaUnsupported')}</div>
        <div className="text-xs">{t('preview.mediaUnsupportedHint')}</div>
        <a
          href={src}
          download
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
        >
          <Download className="size-3.5" />
          {t('preview.download')}
        </a>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center overflow-hidden rounded border border-border bg-black/90">
      <video
        src={src}
        controls
        preload="metadata"
        onError={() => setFailed(true)}
        className="max-h-full max-w-full"
      />
    </div>
  );
}