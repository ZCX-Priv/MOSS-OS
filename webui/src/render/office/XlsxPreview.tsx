// render/office/XlsxPreview.tsx
// Excel (.xlsx) 预览：exceljs 解析 workbook → sheet 切换 + HTML 表格
// （合并单元格 rowSpan/colSpan 还原、基础样式对齐）。公式展示计算值。
// 本组件经 React.lazy 懒加载。

import { useEffect, useState, type CSSProperties } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/button';

interface CellData {
  value: string;
  style?: CSSProperties;
}

interface SheetData {
  name: string;
  rows: CellData[][];
  merges: Array<{ top: number; left: number; bottom: number; right: number }>;
}

interface ParsedWorkbook {
  sheets: SheetData[];
  rowCount: number;
  colCount: number;
}

/** A1:B2 → 行列索引（0 基） */
function parseCellRef(ref: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return { row: 0, col: 0 };
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

async function parseWorkbook(buffer: ArrayBuffer): Promise<ParsedWorkbook> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const sheets: SheetData[] = wb.worksheets.map((ws) => {
    const merges: SheetData['merges'] = (ws.model.merges ?? []).map((range: string) => {
      const [a, b] = range.split(':');
      const start = parseCellRef(a);
      const end = parseCellRef(b);
      return { top: start.row, left: start.col, bottom: end.row, right: end.col };
    });

    const rows: CellData[][] = [];
    let colCount = 0;
    ws.eachRow({ includeEmpty: true }, (row, rowNum) => {
      const outRow: CellData[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        colCount = Math.max(colCount, colNum);
        const v = cell.value;
        let value: string;
        if (v === null || v === undefined) {
          value = '';
        } else if (v instanceof Date) {
          value = v.toISOString().slice(0, 10);
        } else if (typeof v === 'object') {
          const obj = v as {
            richText?: Array<{ text: string }>;
            result?: unknown;
            text?: unknown;
            error?: string;
          };
          if (obj.richText) value = obj.richText.map((r) => r.text).join('');
          else if (obj.result !== undefined && obj.result !== null) value = String(obj.result);
          else if (typeof obj.text === 'string') value = obj.text;
          else if (typeof obj.error === 'string') value = `#${obj.error}`;
          else value = '';
        } else {
          value = String(v);
        }
        const style: CSSProperties = {};
        if (cell.font?.bold) style.fontWeight = '600';
        const align = cell.alignment?.horizontal;
        if (align === 'center') style.textAlign = 'center';
        else if (align === 'right') style.textAlign = 'right';
        outRow[colNum - 1] = { value, style: Object.keys(style).length > 0 ? style : undefined };
      });
      rows[rowNum - 1] = outRow;
    });
    // 稀疏行补齐
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i]) rows[i] = [];
    }
    return { name: ws.name, rows, merges };
  });

  return {
    sheets,
    rowCount: Math.max(...sheets.map((s) => s.rows.length), 0),
    colCount: Math.max(...sheets.map((s) => s.rows[0]?.length ?? 0), 0),
  };
}

export interface XlsxPreviewProps {
  buffer: ArrayBuffer;
}

export function XlsxPreview({ buffer }: XlsxPreviewProps) {
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setParsed(null);
    parseWorkbook(buffer)
      .then((result) => {
        if (!cancelled) setParsed(result);
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
  if (parsed === null) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        <span className="text-sm">Parsing workbook…</span>
      </div>
    );
  }

  const sheet = parsed.sheets[active] ?? parsed.sheets[0];
  if (!sheet) {
    return <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">Empty workbook</div>;
  }

  // 合并单元格：起点格 span，覆盖格跳过
  const covered = new Set<string>();
  for (const m of sheet.merges) {
    for (let r = m.top; r <= m.bottom; r++) {
      for (let c = m.left; c <= m.right; c++) {
        if (r !== m.top || c !== m.left) covered.add(`${r}:${c}`);
      }
    }
  }
  const spanOf = (rowIdx: number, colIdx: number): { rowSpan?: number; colSpan?: number } => {
    const m = sheet.merges.find((x) => x.top === rowIdx && x.left === colIdx);
    if (!m) return {};
    return {
      rowSpan: m.bottom - m.top + 1,
      colSpan: m.right - m.left + 1,
    };
  };

  return (
    <div className="flex flex-col gap-2">
      {parsed.sheets.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {parsed.sheets.map((s, i) => (
            <Button
              key={s.name}
              variant={i === active ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setActive(i)}
            >
              {s.name}
            </Button>
          ))}
        </div>
      )}
      <div className="max-h-[70vh] overflow-auto rounded border border-border">
        <table className="xlsx-table w-full border-collapse text-xs">
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r} className="border-b border-border/60">
                {row.map((cell, c) => {
                  if (covered.has(`${r}:${c}`)) return null;
                  const span = spanOf(r, c);
                  return (
                    <td
                      key={c}
                      rowSpan={span.rowSpan}
                      colSpan={span.colSpan}
                      className="border-r border-border/60 px-2 py-1 text-foreground"
                      style={cell?.style}
                    >
                      {cell?.value ?? ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
