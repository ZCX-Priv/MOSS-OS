// render/data/CsvPreview.tsx
// CSV/TSV 表格预览：自写 RFC4180 解析 → HTML 表格（首行视为表头）。
// 行/列超阈值或解析异常 → 回退 CodeFileViewer（文本 + 行号）。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TableProperties } from 'lucide-react';
import { parseDelimited, delimiterForExt } from './csv';
import { CodeFileViewer } from '../code/CodeFileViewer';

/** 表格渲染上限：超过则回退文本视图（避免超大表格卡死 DOM） */
const MAX_ROWS = 3_000;
const MAX_COLS = 200;

export interface CsvPreviewProps {
  text: string;
  path: string;
  ext: string;
}

export function CsvPreview({ text, path, ext }: CsvPreviewProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  const parsed = useMemo(() => {
    try {
      const rows = parseDelimited(text, delimiterForExt(ext));
      const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
      if (rows.length === 0 || rows.length > MAX_ROWS || cols > MAX_COLS) return null;
      return rows;
    } catch {
      return null;
    }
  }, [text, ext]);

  if (parsed === null || failed) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-1">
        <div className="shrink-0 rounded border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
          {t('preview.dataParseFailed')}
        </div>
        <div className="min-h-0 flex-1">
          <CodeFileViewer text={text} path={path} />
        </div>
      </div>
    );
  }

  const header = parsed[0];
  const body = parsed.slice(1);
  const colCount = Math.max(header.length, ...body.map((r) => r.length));

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex shrink-0 items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
        <TableProperties className="size-3.5" />
        <span className="tabular-nums">
          {body.length} × {colCount}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
        <table className="data-table w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {Array.from({ length: colCount }).map((_, c) => (
                <th key={c} className="border-b border-r border-border/60 px-2 py-1 text-left font-medium text-foreground">
                  {header[c] ?? ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className="border-b border-border/60">
                {Array.from({ length: colCount }).map((_, c) => (
                  <td key={c} className="border-r border-border/60 px-2 py-1 text-foreground" title={row[c] ?? ''}>
                    {row[c] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}