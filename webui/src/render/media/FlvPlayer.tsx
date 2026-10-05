// render/media/FlvPlayer.tsx
// FLV 播放：flv.js（纯 JS，经 MediaSource 转封装）播放后端 /media 直链或内存 objectURL。
// 不支持（无 MSE / 编码异常）→ 回退提示 + 下载。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, TriangleAlert } from 'lucide-react';
import { buildMediaUrl } from '../file/fetcher';

export interface FlvPlayerProps {
  /** 磁盘路径（走 media 直链）；内存源时为 undefined */
  path?: string;
  /** 内存源 objectURL（优先于 path） */
  objectUrl?: string;
}

export function FlvPlayer({ path, objectUrl }: FlvPlayerProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const src = objectUrl ?? (path ? buildMediaUrl(path) : '');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    let player: { destroy(): void } | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const mod = await import('flv.js');
        const flvjs = mod.default;
        if (cancelled) return;
        if (!flvjs.isSupported()) {
          setFailed(true);
          return;
        }
        const p = flvjs.createPlayer(
          { type: 'flv', url: src, isLive: false, hasAudio: true, hasVideo: true },
          { enableStashBuffer: false, stashInitialSize: 128 },
        );
        p.attachMediaElement(video);
        p.load();
        // 播放失败（如编码异常）→ 回退
        p.on('error', () => setFailed(true));
        player = p;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      try {
        player?.destroy();
      } catch {
        // 忽略销毁异常
      }
      player = null;
      if (video) {
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [src]);

  if (failed || !src) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <TriangleAlert className="size-6" />
        <div className="max-w-md text-center text-sm">{t('preview.mediaUnsupported')}</div>
        <div className="text-xs">{t('preview.mediaUnsupportedHint')}</div>
        {src && (
          <a
            href={src}
            download
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          >
            <Download className="size-3.5" />
            {t('preview.download')}
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center overflow-hidden rounded border border-border bg-black/90">
      <video ref={videoRef} controls className="max-h-full max-w-full" />
    </div>
  );
}