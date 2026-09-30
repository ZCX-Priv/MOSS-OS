// render/code/CodeFileViewer.tsx
// 代码/文本文件查看器：Shiki 高亮 + CSS counter 行号（编辑器观感）。
// 超过阈值（字节数 / 行数）时不启用高亮，仅纯文本 + 行号（保证大文件不卡）。
// 复用 render/code/shiki（与消息内代码块同引擎）。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { highlightCode, langFromPath } from './shiki';
import { useRenderSettings } from '../core/settings';

/** 高亮字节阈值（超过则纯文本 + 行号） */
const HIGHLIGHT_MAX_BYTES = 1_500_000;
/** 高亮行数阈值 */
const HIGHLIGHT_MAX_LINES = 8_000;

export interface CodeFileViewerProps {
  text: string;
  path: string;
}

/** 纯文本 + 行号（无高亮路径 / 高亮失败回退） */
function PlainLines({ text }: { text: string }) {
  const lines = useMemo(() => text.split('\n'), [text]);
  return (
    <pre className="code-file-plain">
      <code>
        {lines.map((line, i) => (
          <span className="line" key={i}>
            {line}
          </span>
        ))}
      </code>
    </pre>
  );
}

export function CodeFileViewer({ text, path }: CodeFileViewerProps) {
  const { t } = useTranslation();
  const settings = useRenderSettings();
  const [html, setHtml] = useState<string | null>(null);

  const lineCount = useMemo(() => text.split('\n').length, [text]);
  const tooLarge = text.length > HIGHLIGHT_MAX_BYTES || lineCount > HIGHLIGHT_MAX_LINES;
  const lang = langFromPath(path);

  useEffect(() => {
    setHtml(null);
    if (tooLarge || !settings.codeHighlightEnabled || !lang) return;
    let cancelled = false;
    void highlightCode(text, lang).then((result) => {
      if (!cancelled && result) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [text, lang, tooLarge, settings.codeHighlightEnabled]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex shrink-0 items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
        <span className="truncate font-mono">{lang || 'text'}</span>
        <span className="shrink-0 tabular-nums">{t('preview.codeLines', { count: lineCount })}</span>
      </div>
      {tooLarge && (
        <div className="shrink-0 rounded border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
          {t('preview.codeTooLarge')}
        </div>
      )}
      <div className="code-file-viewer min-h-0 flex-1 overflow-auto rounded border border-border bg-muted/20">
        {html !== null ? (
          <div className="code-file-body" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <PlainLines text={text} />
        )}
      </div>
    </div>
  );
}