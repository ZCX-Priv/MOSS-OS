// read/handlers/notebook.ts
// Jupyter notebook (.ipynb) 处理：.ipynb 本质是 JSON，解析 cells 数组，
// 将 code/markdown/raw 单元格及其输出拼接为带行号的文本。
// 每个单元格标注类型，code 单元格的输出（text/plain）也包含在内。

import { readFileSync } from 'node:fs';
import type { ToolResult } from '../../../types';

/** notebook 单元格 source 字段：可能是字符串或字符串数组 */
type CellSource = string | string[];

/** notebook 输出对象 */
interface NotebookOutput {
  text?: CellSource;
  data?: Record<string, CellSource>;
}

/** notebook 单元格 */
interface NotebookCell {
  cell_type: 'code' | 'markdown' | 'raw' | string;
  source?: CellSource;
  outputs?: NotebookOutput[];
}

/** notebook JSON 结构（nbformat 4） */
interface Notebook {
  cells?: NotebookCell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
  nbformat_minor?: number;
}

/**
 * 读取 Jupyter notebook 文件，解析 cells 并拼接为带行号文本。
 */
export async function readNotebook(path: string): Promise<ToolResult> {
  try {
    const raw = readFileSync(path, 'utf8');
    const nb = JSON.parse(raw) as Notebook;
    const cellCount = nb.cells?.length ?? 0;

    const lines: string[] = [`${path} (Jupyter notebook, ${cellCount} cells)`, ''];

    for (const cell of nb.cells ?? []) {
      const type = cell.cell_type ?? 'unknown';
      const src = normalizeSource(cell.source);

      lines.push(`### [${type}] ###`);
      lines.push(...src.split('\n'));

      // 处理 code 单元格的输出
      if (cell.outputs && cell.outputs.length > 0) {
        lines.push('--- outputs ---');
        for (const out of cell.outputs) {
          const outText = normalizeOutput(out);
          if (outText) {
            lines.push(...outText.split('\n'));
          }
        }
      }
      lines.push('');
    }

    // 加行号
    const width = String(lines.length).length;
    const numbered = lines
      .map((line, i) => `${String(i + 1).padStart(width, ' ')}→${line}`)
      .join('\n');

    return {
      content: [{ type: 'text', text: numbered }],
      metadata: { type: 'notebook', cells: cellCount },
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error reading notebook: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
}

/** 将 source 字段（string | string[]）统一为 string */
function normalizeSource(src?: CellSource): string {
  if (!src) return '';
  if (Array.isArray(src)) return src.join('');
  return src;
}

/** 提取输出的文本内容（优先 text/plain） */
function normalizeOutput(out: NotebookOutput): string {
  const raw = out.text ?? out.data?.['text/plain'] ?? '';
  return normalizeSource(raw);
}
