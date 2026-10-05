// render/office/ooxml-sheet/SheetViewer.tsx
// OOXML 电子表格入口（xlsx/xlsm/xltx/xltm，及 OOXML 形态的 WPS .et）：
// 调用自写 parser（保留样式/合并/列宽/日期）解析为统一 WorkbookModel，
// 再交给统一观感组件 WorkbookViewer 渲染（与 SheetJS 兜底观感完全一致）。
// 旧格式（xls/xlsb/ods/et）由 SheetJS 兜底（SpreadsheetPreview）。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { WorkbookViewer } from '../WorkbookViewer';
import { parseOoxmlWorkbook } from './parser';
import type { WorkbookModel } from '../sheet-model';

export interface SheetViewerProps {
  buffer: ArrayBuffer;
  fileName: string;
}

export function SheetViewer({ buffer, fileName }: SheetViewerProps) {
  const [workbook, setWorkbook] = useState<WorkbookModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setWorkbook(null);
    setError(null);
    void parseOoxmlWorkbook(buffer)
      .then((wb) => {
        if (!cancelled) setWorkbook(wb);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [buffer]);

  if (error !== null) {
    return <div className="flex h-full items-center justify-center text-sm text-destructive">{error}</div>;
  }
  if (workbook === null) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        <span className="text-sm">{fileName}</span>
      </div>
    );
  }
  return <WorkbookViewer workbook={workbook} fileName={fileName} />;
}