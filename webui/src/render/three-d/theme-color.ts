// render/three-d/theme-color.ts
// 把主题 CSS 变量解析成「three 能解析的不透明实色」。
//
// 背景：本项目的主题变量是 oklch()（见 styles/global.css），而 three 的 Color 只支持
// #hex / rgb() / hsl() / 颜色名 —— 直接传 "var(--border)" 或 oklch 串会导致
// `THREE.Color: Unknown color model ...` 并把颜色落回默认值（网格线变纯白、不随主题）。
//
// 做法：
//  1) 探针元素 style.color = var(--x) → getComputedStyle 取得「变量链解析后的最终颜色串」
//     （不依赖变量是 oklch / rgb / 十六进制 / var 引用）；
//  2) 交给 canvas 的 fillStyle 做权威解析（浏览器能解析 oklch）→ getImageData 拿到 0-255 的 sRGB；
//  3) 暗色下 --border 是半透明（oklch(1 0 0 / 10%)），three 只认颜色不认 alpha，
//     故按 alpha 与 --background 合成为「视觉等效的不透明色」，避免网格线变成刺眼纯白。
//
// 纯 DOM 计算，不依赖 three；随主题（.dark / data-theme / 内联样式变化）自动重算。

import { useEffect, useState } from 'react';

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 取变量链解析后的最终颜色串（探针元素法） */
function resolveVarColor(varName: string, fallback: string): string {
  if (typeof document === 'undefined' || !document.body) return fallback;
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = `var(${varName})`;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color.trim();
  probe.remove();
  return resolved || fallback;
}

/** 用 canvas 把任意 CSS 颜色串解析为 sRGB 分量（浏览器能解析 oklch/rgb/hsl/#hex） */
function parseColor(cssColor: string): Rgba | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, 1, 1);
  const data = ctx.getImageData(0, 0, 1, 1).data;
  if (data[3] === 0) return null;
  return { r: data[0], g: data[1], b: data[2], a: data[3] / 255 };
}

/** 变量 → 不透明实色（`rgb(r, g, b)`，three 可解析） */
export function resolveOpaqueColor(varName: string, fallback: string): string {
  const fg = parseColor(resolveVarColor(varName, fallback));
  if (!fg) return fallback;
  const round = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  if (fg.a >= 1) return `rgb(${round(fg.r)}, ${round(fg.g)}, ${round(fg.b)})`;
  const bg = parseColor(resolveVarColor('--background', '#ffffff')) ?? { r: 255, g: 255, b: 255, a: 1 };
  const mix = (f: number, b: number) => round(f * fg.a + b * (1 - fg.a));
  return `rgb(${mix(fg.r, bg.r)}, ${mix(fg.g, bg.g)}, ${mix(fg.b, bg.b)})`;
}

export interface ThreeThemeColors {
  /** 网格细线色（--border，暗色下半透明 → 与背景合成） */
  gridCell: string;
  /** 网格分区线色（--primary） */
  gridSection: string;
}

function readThreeThemeColors(): ThreeThemeColors {
  return {
    gridCell: resolveOpaqueColor('--border', '#d4d4d8'),
    gridSection: resolveOpaqueColor('--primary', '#3b82f6'),
  };
}

/** 订阅主题变化，返回 three 可解析的网格配色 */
export function useThreeThemeColors(): ThreeThemeColors {
  const [colors, setColors] = useState<ThreeThemeColors>(readThreeThemeColors);
  useEffect(() => {
    const read = () => setColors(readThreeThemeColors());
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
    if (document.body) {
      observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    }
    return () => observer.disconnect();
  }, []);
  return colors;
}