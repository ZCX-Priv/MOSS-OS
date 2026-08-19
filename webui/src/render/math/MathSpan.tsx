// render/math/MathSpan.tsx
// 公式渲染组件：KaTeX 同步优先（~90% 场景秒出，含 mhchem 物理化学生物公式）；
// KaTeX 失败且块已闭合时懒加载 MathJax 4 重渲（复杂宏/amscd 100% 覆盖）；
// 全部失败显示原始 LaTeX 文本（mono，不丢内容）。
//
// 流式行为：未闭合（closed=false）时公式仍在增长 —— KaTeX 渲染当前前缀，
// 失败只显示原始文本（不触发 MathJax、不显示错误），闭合后才走回退链。

import { useEffect, useState } from 'react';
import { renderKatex } from './katex';
import { mathjaxTypeset } from './mathjax';
import { useRenderSettings } from '../core/settings';

export interface MathSpanProps {
  tex: string;
  /** 块级（display）还是行内公式 */
  display: boolean;
  /** 所在块是否已闭合（流式） */
  closed: boolean;
}

export function MathSpan({ tex, display, closed }: MathSpanProps) {
  const settings = useRenderSettings();
  const mathEnabled = settings.mathEnabled;
  const fallbackEnabled = settings.mathFallback;

  const [katexHtml, setKatexHtml] = useState<string | null>(() =>
    mathEnabled ? renderKatex(tex, display) : null,
  );
  const [fallbackHtml, setFallbackHtml] = useState<string | null>(null);
  const [fallbackFailed, setFallbackFailed] = useState(false);

  useEffect(() => {
    if (!mathEnabled) return;
    // tex 变化：重置回退状态，先走 KaTeX
    setFallbackHtml(null);
    setFallbackFailed(false);
    const k = renderKatex(tex, display);
    setKatexHtml(k);
    if (k !== null) return;
    // KaTeX 失败：未闭合（流式中）等待，不做回退
    if (!closed || !fallbackEnabled) return;
    let cancelled = false;
    mathjaxTypeset(tex, display)
      .then((html) => {
        if (!cancelled) setFallbackHtml(html);
      })
      .catch(() => {
        if (!cancelled) setFallbackFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tex, display, closed, mathEnabled, fallbackEnabled]);

  // 公式渲染总开关关闭：显示原始 LaTeX
  if (!mathEnabled) {
    return <code className="math-raw">{tex}</code>;
  }

  const html = katexHtml ?? fallbackHtml;
  if (html !== null) {
    return display ? (
      <div
        className="math-display"
        // KaTeX/MathJax 输出为库生成的可信 HTML（trust:false 禁用 \href 等危险命令）
        dangerouslySetInnerHTML={{ __html: html }}
      />
    ) : (
      <span className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />
    );
  }

  // 未闭合流式 / 回退中 / 回退失败：原始文本（回退失败时红色标记）
  return <code className={fallbackFailed ? 'math-raw math-failed' : 'math-raw'}>{tex}</code>;
}
