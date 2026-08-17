// read/handlers/pdf.ts
// PDF 文件处理：动态 import pdf-parse v2 的 PDFParse 类，提取文本。
// v2 API：new PDFParse({ data }) → getText(params) → destroy()
// 注意：destroy() 必须在 finally 中调用，释放 pdfjs worker 句柄避免内存泄漏。

import { readFileSync } from 'node:fs';
import type { ToolResult } from '../../../types';

/** pdf-parse v2 的 TextResult 结构 */
interface PdfTextResult {
  text: string;
  total: number;
  pages: Array<{ num: number; text: string }>;
}

/** pdf-parse v2 的 ParseParameters（仅用到的字段） */
interface PdfParseParams {
  /** 指定页码数组，如 [1, 3, 5] */
  partial?: number[];
}

/** pdf-parse v2 的 PDFParse 实例类型 */
interface PDFParseInstance {
  getText(params?: PdfParseParams): Promise<PdfTextResult>;
  destroy(): Promise<void>;
}

/** pdf-parse v2 的 PDFParse 类构造类型 */
interface PDFParseClass {
  new (options: { data: Uint8Array }): PDFParseInstance;
}

/** pdf-parse v2 模块导出结构 */
interface PdfParseModule {
  PDFParse: PDFParseClass;
}

/**
 * 读取 PDF 文件，提取文本内容。
 * @param path PDF 文件绝对路径
 * @param pages 可选页码范围，如 "1-5" 或 "3"
 */
export async function readPdf(path: string, pages?: string): Promise<ToolResult> {
  // 动态 import v2 模块（命名导出 PDFParse 类）
  const mod = (await import('pdf-parse')) as PdfParseModule;
  const buf = readFileSync(path);
  // Buffer → Uint8Array（v2 的 data 参数类型要求 TypedArray）
  const data = new Uint8Array(buf);
  const parser = new mod.PDFParse({ data });

  try {
    // 解析页码范围 → v2 的 partial 参数
    const params = pages ? { partial: parsePageRange(pages) } : undefined;
    const result = await parser.getText(params);

    const header = pages
      ? `${path} (PDF, pages ${pages}, total ${result.total} pages)\n`
      : `${path} (PDF, ${result.total} pages)\n`;

    return {
      content: [{ type: 'text', text: header + result.text }],
      metadata: {
        type: 'pdf',
        pages: result.total,
        requestedPages: pages ?? null,
      },
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error reading PDF: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  } finally {
    // v2 必须调用 destroy() 释放 pdfjs worker 句柄，避免内存泄漏
    await parser.destroy();
  }
}

/**
 * 解析页码范围字符串为 v2 的 partial 数组。
 * "1-5" → [1, 2, 3, 4, 5]
 * "3" → [3]
 * 无效 → 空数组（调用方不传 partial，表示全部页）
 */
function parsePageRange(pages: string): number[] {
  const m = pages.match(/(\d+)(?:-(\d+))?/);
  if (!m) return [];
  const start = parseInt(m[1], 10);
  if (!m[2]) return [start];
  const end = parseInt(m[2], 10);
  const result: number[] = [];
  for (let i = start; i <= end; i++) {
    result.push(i);
  }
  return result;
}
