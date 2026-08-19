// render/math/katex.ts
// KaTeX 封装：mhchem 扩展（\ce 化学方程式）+ renderToString 结果缓存。
// throwOnError:true —— 不支持的命令抛异常，由 MathSpan 触发 MathJax 回退。

import katex from 'katex';
import 'katex/dist/contrib/mhchem.mjs';

const CACHE_MAX = 500;
const cache = new Map<string, string>();

/**
 * KaTeX 渲染为 HTML 字符串（可信输出，可直接注入）。
 * 失败（不支持命令/语法错误）返回 null —— 调用方决定回退策略。
 */
export function renderKatex(tex: string, displayMode: boolean): string | null {
  const key = `${displayMode ? 'D' : 'I'}:${tex}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  try {
    const html = katex.renderToString(tex, {
      displayMode,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      errorColor: '#cc0000',
    });
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, html);
    return html;
  } catch {
    // 失败不缓存（流式中公式可能还在增长，闭合后语义会变）
    return null;
  }
}
