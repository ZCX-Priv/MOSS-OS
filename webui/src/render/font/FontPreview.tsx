// render/font/FontPreview.tsx
// 字体文件预览（全格式）：fontkit 元数据解析 + 双路径样张渲染
//   A 路径（优先）：浏览器原生可加载的 ttf/otf/woff/woff2（含 EOT 解出的内嵌 TTF）→ FontFace + 多字号样张
//   B 路径（兜底）：fontkit 逐字形轮廓绘制到 canvas —— 覆盖 ttc/otc/dfont 等 FontFace 不支持的格式
//   TTC/OTC：fontkit 返回集合，提供子字体切换下拉
//   EOT：自解 EOT 头得到内嵌 TTF 后交给 A 路径
//   Type1(.pfb/.pfm/.fon) 等无法解析者 → 明确提示（不报错）
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Type } from 'lucide-react';
import type { RefObject } from 'react';
import type { FontkitFont } from 'fontkit';

const SAMPLE_EN = 'The quick brown fox jumps over the lazy dog 0123456789';
const SAMPLE_ZH = '汉字字体样张：永和九年，岁在癸丑，暮春之初';
const SIZES = [14, 18, 24, 36, 56] as const;
/** 浏览器 FontFace 可直接加载的格式 */
const NATIVE_EXTS = ['ttf', 'otf', 'woff', 'woff2'] as const;

export interface FontPreviewProps {
  buffer: ArrayBuffer;
  ext: string;
  fileName: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; bytes: Uint8Array<ArrayBuffer>; fonts: FontkitFont[]; native: boolean }
  | { status: 'error'; message: string };

/** 由文件名派生稳定的 CSS 字体族名（避免与页面字体冲突） */
function familyNameOf(fileName: string): string {
  let hash = 0;
  for (let i = 0; i < fileName.length; i++) {
    hash = (hash * 31 + fileName.charCodeAt(i)) >>> 0;
  }
  return `moss-preview-font-${hash.toString(36)}`;
}

// ── EOT：自解头，取出末尾内嵌的字体数据 ──────────────────────────────────────
/** 常见字体文件签名（大端 4 字节） */
const FONT_SIGNATURES = [0x00010000, 0x4f54544f, 0x74727565, 0x74746366, 0x774f4646, 0x774f4632];

function hasFontSignature(bytes: Uint8Array<ArrayBuffer>, offset: number): boolean {
  if (offset < 0 || offset + 4 > bytes.length) return false;
  const sig =
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  return FONT_SIGNATURES.includes(sig);
}

/**
 * EOT 头：偏移 0 = EOTSize（总长），偏移 4 = FontDataSize（内嵌字体字节数），
 * FontData 位于文件尾部。优先按 EOTSize−FontDataSize 定位并校验字体签名，失败则退回“末尾 FontDataSize 字节”。
 */
function extractEotFont(raw: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> | null {
  if (raw.length < 82) return null;
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const eotSize = view.getUint32(0, true);
  const fontDataSize = view.getUint32(4, true);
  if (fontDataSize <= 0 || fontDataSize > raw.length) return null;

  const candidates = [eotSize - fontDataSize, raw.length - fontDataSize];
  for (const start of candidates) {
    if (start >= 0 && start + fontDataSize <= raw.length && hasFontSignature(raw, start)) {
      return raw.subarray(start, start + fontDataSize);
    }
  }
  const fallbackStart = raw.length - fontDataSize;
  return fallbackStart >= 0 ? raw.subarray(fallbackStart) : null;
}

// ── 元素宽度（canvas 样张按容器宽度绘制；宽度变化时重绘） ──────────────────────
function useElementWidth<T extends HTMLElement>(ref: RefObject<T | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

// ── B 路径：fontkit 逐字形轮廓绘制 ────────────────────────────────────────────
/** 在 (x0, baseline) 处以 px 字号逐字形填充一行文本；超过 maxX 停止（不换行） */
function drawTextLine(
  ctx: CanvasRenderingContext2D,
  font: FontkitFont,
  text: string,
  x0: number,
  baseline: number,
  px: number,
  maxX: number,
): void {
  const scale = px / font.unitsPerEm;
  let x = x0;
  for (const ch of text) {
    if (x > maxX) break;
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    const glyph = font.glyphForCodePoint(cp);
    const svg = glyph.path.toSVG();
    if (svg) {
      const path = new Path2D(svg);
      ctx.save();
      ctx.translate(x, baseline);
      // 字体坐标系 y 轴向上，canvas y 轴向下 → 纵向翻转
      ctx.scale(scale, -scale);
      ctx.fill(path);
      ctx.restore();
    }
    x += glyph.advanceWidth * scale;
  }
}

/** 单行样张（canvas）：按容器宽度自适应 */
function GlyphLine({ font, text, px }: { font: FontkitFont; text: string; px: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = useElementWidth(wrapRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const height = Math.ceil(px * 1.45);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = getComputedStyle(canvas).color || '#111827';
    drawTextLine(ctx, font, text, 2, px + 2, px, width - 4);
  }, [font, text, px, width]);

  return (
    <div ref={wrapRef} className="w-full overflow-hidden">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}

export function FontPreview({ buffer, ext, fileName }: FontPreviewProps) {
  const { t } = useTranslation();
  const family = useMemo(() => familyNameOf(fileName), [fileName]);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [index, setIndex] = useState(0);
  const [faceState, setFaceState] = useState<'pending' | 'ready' | 'failed'>('pending');

  // ── 解析字体（fontkit） ──
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    setIndex(0);

    void (async () => {
      try {
        const raw = new Uint8Array(buffer);
        let bytes: Uint8Array<ArrayBuffer> = raw;
        let nativeExt = ext.toLowerCase();
        if (nativeExt === 'eot') {
          const embedded = extractEotFont(raw);
          if (!embedded) throw new Error('EOT: embedded font data not found');
          bytes = embedded;
          nativeExt = 'ttf'; // 内嵌多为 TTF/OTF
        }
        const { create } = await import('fontkit');
        const result = create(bytes);
        const fonts = 'fonts' in result ? result.fonts : [result];
        if (fonts.length === 0) throw new Error('Font collection is empty');
        const native = NATIVE_EXTS.includes(nativeExt as (typeof NATIVE_EXTS)[number]);
        if (!cancelled) setState({ status: 'ok', bytes, fonts, native });
      } catch (err: unknown) {
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [buffer, ext]);

  // ── A 路径：FontFace 注册（仅原生格式且非集合） ──
  useEffect(() => {
    if (state.status !== 'ok' || !state.native) {
      setFaceState('failed');
      return;
    }
    let cancelled = false;
    let added: FontFace | null = null;
    setFaceState('pending');
    void (async () => {
      try {
        const face = new FontFace(family, state.bytes.slice(0));
        const loaded = await face.load();
        if (cancelled) return;
        document.fonts.add(loaded);
        added = loaded;
        setFaceState('ready');
      } catch {
        if (!cancelled) setFaceState('failed');
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
  }, [state, family]);

  if (state.status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-destructive">
        <Type className="size-6" />
        <div className="text-sm">{t('preview.fontUnsupported')}</div>
        <div className="max-w-md text-center text-xs text-muted-foreground">{state.message}</div>
      </div>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('preview.loading')}
      </div>
    );
  }

  const { fonts } = state;
  const active = fonts[Math.min(index, fonts.length - 1)];
  const useCanvas = !state.native || faceState === 'failed';
  const faceStyle = { fontFamily: `"${family}", system-ui, sans-serif` };

  const metaRows: Array<{ label: string; value: string | null }> = [
    { label: t('preview.fontMetaFamily'), value: active.familyName },
    { label: t('preview.fontMetaSubfamily'), value: active.subfamilyName },
    { label: t('preview.fontMetaVersion'), value: active.version },
    { label: t('preview.fontMetaPostscript'), value: active.postscriptName },
    { label: t('preview.fontMetaUnits'), value: String(active.unitsPerEm) },
    { label: t('preview.fontMetaGlyphs'), value: String(active.numGlyphs) },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto rounded border border-border p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Type className="size-3.5" />
        <span className="truncate font-mono">{fileName}</span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px]">
          {t('preview.fontMeta', { ext: ext.toUpperCase() })}
        </span>
        {fonts.length > 1 && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px]">
            {t('preview.fontCollection', { count: fonts.length })}
          </span>
        )}
      </div>

      {/* 集合子字体切换（TTC/OTC） */}
      {fonts.length > 1 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">{t('preview.fontCollectionPick')}</span>
          <select
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
            className="h-7 max-w-full flex-1 rounded border border-border bg-background px-1.5 text-xs text-foreground"
          >
            {fonts.map((f, i) => (
              <option key={i} value={i}>
                {f.fullName ?? f.postscriptName ?? `#${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* 元数据 */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 rounded border border-border/60 bg-muted/20 p-2.5 text-[11px] sm:grid-cols-2">
        {metaRows
          .filter((row) => row.value !== null && row.value !== '')
          .map((row) => (
            <div key={row.label} className="flex min-w-0 gap-1.5">
              <span className="shrink-0 text-muted-foreground">{row.label}:</span>
              <span className="truncate font-mono text-foreground">{row.value}</span>
            </div>
          ))}
        <div className="flex min-w-0 gap-1.5 sm:col-span-2">
          <span className="shrink-0 text-muted-foreground">{t('preview.fontMetaMetrics')}:</span>
          <span className="truncate font-mono text-foreground">
            {active.ascent} / {active.descent} / {active.capHeight} / {active.xHeight}
          </span>
        </div>
      </div>

      <div className="text-[11px] font-medium text-muted-foreground">{t('preview.fontSampleText')}</div>

      {state.native && faceState === 'pending' ? (
        <div className="py-6 text-center text-sm text-muted-foreground">{t('preview.loading')}</div>
      ) : (
        SIZES.map((size) => (
          <div key={size} className="flex flex-col gap-1 border-b border-border/50 pb-2 last:border-b-0">
            <span className="text-[10px] text-muted-foreground">{size}px</span>
            {useCanvas ? (
              <>
                <GlyphLine font={active} text={SAMPLE_EN} px={size} />
                <GlyphLine font={active} text={SAMPLE_ZH} px={size} />
              </>
            ) : (
              <>
                <div className="font-preview-sample" style={{ ...faceStyle, fontSize: `${size}px` }}>
                  {SAMPLE_EN}
                </div>
                <div style={{ ...faceStyle, fontSize: `${size}px` }}>{SAMPLE_ZH}</div>
              </>
            )}
          </div>
        ))
      )}
    </div>
  );
}