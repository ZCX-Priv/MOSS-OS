// render/media/AudioPlayer.tsx
// 音频播放：后端 /api/filesystem/media 直链（支持 HTTP Range）。
// 浏览器不支持的容器/编码（如 wma/amr/midi）→ 回退提示 + 下载。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Music, TriangleAlert } from 'lucide-react';
import { buildMediaUrl, isNativeAudioExt } from '../file/fetcher';

export interface AudioPlayerProps {
  path: string;
  ext: string;
}

export function AudioPlayer({ path, ext }: AudioPlayerProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const src = buildMediaUrl(path);

  if (!isNativeAudioExt(ext) || failed) {
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
    <div className="flex h-full flex-col items-center justify-center gap-4 rounded border border-border bg-muted/20 p-6">
      <Music className="size-10 text-primary-strong" />
      <div className="w-full max-w-lg truncate text-center font-mono text-xs text-muted-foreground">{path}</div>
      <audio src={src} controls preload="metadata" onError={() => setFailed(true)} className="w-full max-w-lg" />
    </div>
  );
}