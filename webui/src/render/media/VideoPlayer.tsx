// render/media/VideoPlayer.tsx
// 视频播放（Video.js）：统一专业 UI（播放/进度/音量/画中画/全屏/倍速），
// 内置 VHS 支持 HLS（.m3u8）流媒体；内存源（压缩包内层）用 objectURL。
// FLV 由 FlvPlayer（flv.js）单独处理（Video.js 无内置 FLV tech）。
// 浏览器不支持的容器/编码 → 明确提示 + 下载。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, TriangleAlert } from 'lucide-react';
import { buildMediaUrl } from '../file/fetcher';
import 'video.js/dist/video-js.css';

export interface VideoPlayerProps {
  /** 磁盘路径（走 media 直链）；内存源时为 undefined */
  path?: string;
  /** 内存源 objectURL（优先于 path） */
  objectUrl?: string;
  ext: string;
}

/** 扩展名 → MIME（供 Video.js / VHS 选择 tech） */
function sourceType(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'm3u8':
      return 'application/x-mpegURL';
    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'ogv':
      return 'video/ogg';
    case 'mov':
      return 'video/quicktime';
    case 'mkv':
      return 'video/x-matroska';
    case 'avi':
      return 'video/x-msvideo';
    case 'wmv':
      return 'video/x-ms-wmv';
    case '3gp':
      return 'video/3gpp';
    case '3g2':
      return 'video/3gpp2';
    case 'mpg':
    case 'mpeg':
      return 'video/mpeg';
    case 'ts':
    case 'm2ts':
      return 'video/mp2t';
    case 'rmvb':
      return 'application/vnd.rn-realmedia-vbr';
    default:
      return 'video/mp4';
  }
}

interface PlayerLike {
  dispose(): void;
  on(event: string, cb: () => void): void;
}

export function VideoPlayer({ path, objectUrl, ext }: VideoPlayerProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const src = objectUrl ?? (path ? buildMediaUrl(path) : '');

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !src) return;
    let cancelled = false;
    let player: PlayerLike | null = null;

    void (async () => {
      try {
        const mod = await import('video.js');
        if (cancelled) return;
        const videojs = mod.default;
        host.innerHTML = '';
        const el = document.createElement('video');
        el.className = 'video-js vjs-default-skin vjs-big-play-centered';
        el.setAttribute('playsinline', '');
        el.setAttribute('controls', '');
        el.setAttribute('preload', 'metadata');
        host.appendChild(el);
        player = videojs(el, {
          controls: true,
          autoplay: false,
          preload: 'metadata',
          fill: true,
          responsive: true,
          html5: {
            // HLS：启用内置 VHS（http-streaming）并把 m3u8 交给它处理
            vhs: { overrideNative: true },
          },
          sources: [{ src, type: sourceType(ext) }],
        }) as unknown as PlayerLike;
        player.on('error', () => setFailed(true));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      try {
        player?.dispose();
      } catch {
        // 忽略销毁异常
      }
      player = null;
      if (host) host.innerHTML = '';
    };
  }, [src, ext]);

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
      <div ref={hostRef} className="video-js-host h-full w-full" />
    </div>
  );
}