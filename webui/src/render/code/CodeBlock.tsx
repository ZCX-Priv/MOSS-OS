// render/code/CodeBlock.tsx
// 代码块组件：流式中（closed=false）纯文本 mono 显示；闭合后 Shiki 高亮一次（闭块 memo 冻结，
// 后续流式 token 不会重触发高亮）。mermaid 语言分流到 MermaidDiagram；smiles 分流到 SmilesDiagram。
// 未知语言 / 高亮引擎失败回退纯文本 pre。

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { highlightCode } from './shiki';
import { MermaidDiagram } from '../diagram/MermaidDiagram';
import { SmilesDiagram } from '../chem/SmilesDiagram';
import { useRenderSettings } from '../core/settings';

export interface CodeBlockProps {
  code: string;
  /** fence info string（语言标识，可能为空） */
  lang: string;
  /** 所在块是否闭合（流式） */
  closed: boolean;
}

export function CodeBlock({ code, lang, closed }: CodeBlockProps) {
  const settings = useRenderSettings();
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const normalizedLang = lang.trim().toLowerCase();

  useEffect(() => {
    if (!closed || !settings.codeHighlightEnabled || !normalizedLang) return;
    let cancelled = false;
    void highlightCode(code, normalizedLang).then((result) => {
      if (!cancelled && result) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code, normalizedLang, closed, settings.codeHighlightEnabled]);

  // mermaid 分流（仅在块闭合后成图，流式中显示源码 —— 无闪烁）
  if (normalizedLang === 'mermaid' && closed && settings.mermaidEnabled) {
    return <MermaidDiagram code={code} />;
  }

  // SMILES 分流（有机分子 2D 结构图：苯环/杂环等；闭合后成图，流式中显示源码）
  if ((normalizedLang === 'smiles' || normalizedLang === 'smi') && closed) {
    return <SmilesDiagram smiles={code} />;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用（非安全上下文）静默忽略
    }
  };

  return (
    <div className="code-block group/code relative my-3 overflow-hidden rounded-md border border-border bg-muted/40">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
        <span className="font-mono text-[11px] text-muted-foreground">{normalizedLang || 'text'}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:opacity-100"
          aria-label="copy code"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </div>
      {html !== null ? (
        <div
          className="shiki-wrap overflow-x-auto p-3 text-[13px] leading-relaxed"
          // Shiki 输出为受控 HTML（只含 span 着色节点）
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed text-foreground">
          <code>{code}</code>
          {!closed && (
            <span className="code-cursor ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] animate-pulse bg-primary" />
          )}
        </pre>
      )}
    </div>
  );
}
