// render/office/PptxOutline.tsx
// PowerPoint (.pptx) 文本大纲：JSZip 解析每页 slide XML 提取 <a:t> 文本。
// 纯前端无高保真 pptx 渲染方案 —— 明确提示保真受限，仅提取文本大纲。

import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface PptxOutlineProps {
  buffer: ArrayBuffer;
}

interface SlideOutline {
  index: number;
  texts: string[];
}

async function parsePptx(buffer: ArrayBuffer): Promise<SlideOutline[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);
  const slides: SlideOutline[] = [];
  const files = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(/slide(\d+)\.xml$/.exec(a)?.[1] ?? 0);
      const nb = Number(/slide(\d+)\.xml$/.exec(b)?.[1] ?? 0);
      return na - nb;
    });
  for (const name of files) {
    const xml = await zip.files[name].async('string');
    const texts: string[] = [];
    const re = /<a:t>([^<]*)<\/a:t>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const text = m[1].trim();
      if (text) texts.push(text);
    }
    slides.push({ index: slides.length + 1, texts });
  }
  return slides;
}

export function PptxOutline({ buffer }: PptxOutlineProps) {
  const { t } = useTranslation();
  const [slides, setSlides] = useState<SlideOutline[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSlides(null);
    parsePptx(buffer)
      .then((result) => {
        if (!cancelled) setSlides(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [buffer]);

  if (error !== null) {
    return <div className="flex h-[60vh] items-center justify-center text-sm text-destructive">{error}</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Info className="size-3.5 shrink-0" />
        <span>{t('settings.render.pptxLimited')}</span>
      </div>
      <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
        {(slides ?? []).map((slide) => (
          <div key={slide.index} className="rounded-md border border-border p-3">
            <div className="mb-1.5 font-mono text-[11px] text-muted-foreground">Slide {slide.index}</div>
            {slide.texts.length === 0 ? (
              <div className="text-xs text-muted-foreground">—</div>
            ) : (
              <ul className="space-y-1">
                {slide.texts.map((text, i) => (
                  <li key={i} className="text-sm text-foreground">
                    {text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {slides === null && (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Parsing…</div>
        )}
      </div>
    </div>
  );
}
