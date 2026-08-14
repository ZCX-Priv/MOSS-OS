// read/handlers/office.ts
// Office 文档处理：DOCX 用 mammoth 转 markdown，XLSX 用 xlsx 转 CSV。
// 两个库均通过 await import() 动态懒加载，避免未安装时启动失败。
// PPTX 支持有限（mammoth 不支持），返回提示信息。

import { readFileSync } from 'node:fs';
import { extname, basename } from 'node:path';
import type { ToolResult } from '../../../types';

/** mammoth.extractRawText 返回结构 */
interface MammothResult {
  value: string;
  messages: unknown[];
}

/** mammoth 模块类型（官方 API：convertToHtml / extractRawText） */
interface MammothModule {
  extractRawText(input: { buffer: Buffer }): Promise<MammothResult>;
}

/** xlsx 工作簿结构 */
interface XlsxWorkbook {
  SheetNames: string[];
  Sheets: Record<string, unknown>;
}

/** xlsx 模块类型 */
interface XlsxModule {
  readFile(path: string, options?: { cellDates?: boolean }): XlsxWorkbook;
  utils: {
    sheet_to_csv(sheet: unknown, options?: { blankrows?: boolean }): string;
  };
}

/**
 * 读取 Office 文档（DOCX/XLSX/PPTX），提取文本。
 * 根据扩展名分派到对应处理器。
 */
export async function readOffice(path: string): Promise<ToolResult> {
  const ext = extname(path).toLowerCase();
  try {
    if (ext === '.docx') {
      return await readDocx(path);
    }
    if (ext === '.xlsx' || ext === '.xlsm') {
      return await readXlsx(path);
    }
    if (ext === '.pptx') {
      return {
        content: [{ type: 'text', text: `${path} (PPTX)\n\nPPTX 支持有限，mammoth 不支持 PowerPoint。建议用专门工具打开。` }],
        metadata: { type: 'pptx', supported: false },
      };
    }
    return {
      content: [{ type: 'text', text: `Error: unsupported office format: ${ext}` }],
      isError: true,
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error reading office file: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
}

/**
 * 读取 DOCX 文件，用 mammoth 转换为 markdown 文本。
 */
async function readDocx(path: string): Promise<ToolResult> {
  const mod = (await import('mammoth')) as MammothModule & { default?: MammothModule };
  const mammoth: MammothModule = mod.default ?? mod;
  const buf = readFileSync(path);
  const result = await mammoth.extractRawText({ buffer: buf });

  return {
    content: [{ type: 'text', text: `${path} (DOCX)\n${result.value}` }],
    metadata: { type: 'docx' },
  };
}

/**
 * 读取 XLSX 文件，用 xlsx 库转为 CSV 格式，每个工作表分块展示。
 */
async function readXlsx(path: string): Promise<ToolResult> {
  const mod = (await import('xlsx')) as XlsxModule & { default?: XlsxModule };
  const XLSX: XlsxModule = mod.default ?? mod;
  const wb = XLSX.readFile(path, { cellDates: true });

  const lines: string[] = [
    `Workbook: ${basename(path)}`,
    `Sheets: ${wb.SheetNames.join(', ')}`,
    '',
  ];

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    lines.push(`## Sheet: ${name}`, '```csv', csv, '```', '');
  }

  return {
    content: [{ type: 'text', text: `${path} (XLSX)\n${lines.join('\n')}` }],
    metadata: { type: 'xlsx', sheets: wb.SheetNames.length },
  };
}
