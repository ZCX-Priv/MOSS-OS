// render/font/FontPreview.tsx
// 字体文件预览（ttf/otf/woff/woff2/eot）：FontFace API 加载 → 多字号样张。
// 加载失败（浏览器不支持该格式/文件损坏）→ 提示错误。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Type } from 'lucide-react';

const SAMPLE_EN = 'The quick brown fox jumps over the lazy dog 0123456789';
const SAMPLE_ZH = '汉字字体样张：永和九年，岁在癸丑，暮春之初';
const SIZES = [14, 18, 24, 36, 56] as const;

export interface FontPreviewProps {
  buffer: ArrayBuffer;
  ext: string;
  fileName: string;
}

/** 由文件名派生稳定的 CSS 字体族名（避免与页面字体冲突） */
function familyNameOf(fileName: string): string {
  let hash = 0;
  for (let i = 0; i < fileName.length; i++) {
    hash = (hash * 31 + fileName.charCodeAt(i)) >>> 0;
  }
  return `moss-preview-font-${hash.toString(36)}`;
}

export function FontPreview({ buffer, ext, fileName }: FontPreviewProps) {
  const { t } = useTranslation();
  const family = useMemo(() => familyNameOf(fileName), [fileName]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let added: FontFace | null = null;
    setReady(false);
    setError(null);

    void (async () => {
      try {
        const face = new FontFace(family, buffer);
        const loaded = await face.load();
        if (cancelled) return;
        document.fonts.add(loaded);
        added = loaded;
        setReady(true);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      if (added) {
        try {
          document.fonts.delete(added);
        } catch {
          // 忽略删除失败
        }
      }
    };
  }, [buffer, family]);

  if (error !== null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-destructive">
        <Type className="size-6" />
        <div className="text-sm">{t('preview.fontLoadFailed')}</div>
        <div className="max-w-md text-center text-xs text-muted-foreground">{error}</div>
      </div>
    );
  }

  if (!ready) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('preview.loading')}</div>;
  }

  const style = { fontFamily: `"${family}", system-ui, sans-serif` };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto rounded border border-border p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Type className="size-3.5" />
        <span className="truncate font-mono">{fileName}</span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px]">
          {t('preview.fontMeta', { ext: ext.toUpperCase() })}
        </span>
      </div>
      <div className="text-[11px] font-medium text-muted-foreground">{t('preview.fontSampleText')}</div>
      {SIZES.map((size) => (
        <div key={size} className="flex flex-col gap-1 border-b border-border/50 pb-2 last:border-b-0">
          <span className="text-[10px] text-muted-foreground">{size}px</span>
          <div className="font-preview-sample" style={{ ...style, fontSize: `${size}px` }}>
            {SAMPLE_EN}
          </div>
          <div style={{ ...style, fontSize: `${size}px` }}>{SAMPLE_ZH}</div>
        </div>
      ))}
    </div>
  );
}