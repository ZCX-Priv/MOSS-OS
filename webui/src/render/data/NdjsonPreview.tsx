// render/data/NdjsonPreview.tsx
// NDJSON / JSON Lines（每行一个 JSON 对象）预览：逐行解析 → 键并集为列 → 表格。
// 单行解析失败标红并原样展示；行数超阈值截断（防超大文件卡顿）。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TableProperties } from 'lucide-react';
import { CodeFileViewer } from '../code/CodeFileViewer';

/** 最多解析的行数 */
const MAX_LINES = 5_000;

export interface NdjsonPreviewProps {
  text: string;
  path: string;
}

interface ParsedLine {
  index: number;
  ok: boolean;
  value: Record<string, unknown> | null;
  raw: string;
}

export function NdjsonPreview({ text, path }: NdjsonPreviewProps) {
  const { t } = useTranslation();

  const { lines, columns } = useMemo(() => {
    const rawLines = text.split('\n');
    const out: ParsedLine[] = [];
    const keyOrder: string[] = [];
    const keySeen = new Set<string>();
    for (let i = 0; i < rawLines.length && out.length < MAX_LINES; i++) {
      const raw = rawLines[i];
      if (raw.trim() === '') continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        const obj = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
        if (obj) {
          for (const k of Object.keys(obj)) {
            if (!keySeen.has(k)) {
              keySeen.add(k);
              keyOrder.push(k);
            }
          }
        }
        out.push({ index: i, ok: true, value: obj, raw });
      } catch {
        out.push({ index: i, ok: false, value: null, raw });
      }
    }
    return { lines: out, columns: keyOrder };
  }, [text]);

  const cellText = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  // 无有效对象（非 JSON Lines）：回退代码视图
  if (columns.length === 0) {
    return <CodeFileViewer text={text} path={path} />;
  }

  const truncated = text.split('\n').length > MAX_LINES;

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex shrink-0 items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
        <TableProperties className="size-3.5" />
        <span className="tabular-nums">
          {lines.length} × {columns.length}
        </span>
        {truncated && <span className="ml-2">{t('preview.extractedTruncated', { chars: MAX_LINES })}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
        <table className="data-table w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="border-b border-r border-border/60 px-2 py-1 text-left font-medium text-foreground">#</th>
              {columns.map((c) => (
                <th key={c} className="border-b border-r border-border/60 px-2 py-1 text-left font-medium text-foreground">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) =>
              line.ok ? (
                <tr key={line.index} className="border-b border-border/60">
                  <td className="border-r border-border/60 px-2 py-1 text-muted-foreground tabular-nums">{line.index + 1}</td>
                  {columns.map((c) => (
                    <td key={c} className="border-r border-border/60 px-2 py-1 text-foreground" title={cellText(line.value?.[c])}>
                      {cellText(line.value?.[c])}
                    </td>
                  ))}
                </tr>
              ) : (
                <tr key={line.index} className="border-b border-border/60 bg-destructive/10">
                  <td className="border-r border-border/60 px-2 py-1 text-destructive tabular-nums">{line.index + 1}</td>
                  <td className="border-r border-border/60 px-2 py-1 font-mono text-destructive" colSpan={columns.length}>
                    {line.raw}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}