// read/handlers/office.ts
// Office/文档处理分派：
// - Word OOXML（docx/docm/dotx）：mammoth 提取纯文本（按内容解析，同族格式均支持）
// - Word OLE 旧版（doc）：word-extractor 提取正文/脚注/页眉页脚
// - Excel（xls/xlsx/xlsm/xltx/xltm）：SheetJS 转 CSV（原生支持读旧版 .xls BIFF）
// - PPT OOXML（pptx/pptm/potx/ppsx）+ ODF（odt/ods/odp）+ RTF：officeparser 提取文本
// - PPT OLE 旧版（ppt）：无成熟纯 JS 解析方案，明确报错提示转换
// 所有库均通过 await import() 动态懒加载，避免未安装时启动失败。

import { readFileSync } from 'node:fs';
import { extname, basename } from 'node:path';
import type { ToolResult } from '../../types';

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

/** word-extractor / officeparser 的类型分别来自 src/types/word-extractor.d.ts 与包自带 d.ts */

/** Word OOXML 家族扩展名（mammoth 按内容解析，同族均可处理） */
const WORD_OOXML_EXTS = new Set(['.docx', '.docm', '.dotx']);

/** Excel 家族扩展名（SheetJS 原生支持读 OOXML 与旧版 BIFF .xls） */
const EXCEL_EXTS = new Set(['.xlsx', '.xlsm', '.xltx', '.xltm', '.xls']);

/** officeparser 处理的扩展名（PPT OOXML / OpenDocument / RTF） */
const OFFICEPARSER_EXTS = new Set([
  '.pptx', '.pptm', '.potx', '.ppsx',
  '.odt', '.ods', '.odp', '.rtf',
]);

/**
 * 读取 Office/文档文件，提取文本。
 * 根据扩展名分派到对应处理器。
 */
export async function readOffice(path: string): Promise<ToolResult> {
  const ext = extname(path).toLowerCase();
  try {
    if (WORD_OOXML_EXTS.has(ext)) {
      return await readDocx(path);
    }
    if (ext === '.doc') {
      return await readLegacyDoc(path);
    }
    if (EXCEL_EXTS.has(ext)) {
      return await readXlsx(path);
    }
    if (OFFICEPARSER_EXTS.has(ext)) {
      return await readWithOfficeParser(path, ext);
    }
    if (ext === '.ppt') {
      return {
        content: [{
          type: 'text',
          text: `Error: legacy PowerPoint (.ppt) is not supported. Please convert the file to .pptx (open in PowerPoint/WPS and "Save As" .pptx), then read again: ${path}`,
        }],
        isError: true,
        metadata: { type: 'ppt', supported: false },
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
 * 读取 Word OOXML 文件（docx/docm/dotx），用 mammoth 提取纯文本。
 */
async function readDocx(path: string): Promise<ToolResult> {
  const mod = (await import('mammoth')) as MammothModule & { default?: MammothModule };
  const mammoth: MammothModule = mod.default ?? mod;
  const buf = readFileSync(path);
  const result = await mammoth.extractRawText({ buffer: buf });

  const ext = extname(path).toLowerCase().slice(1).toUpperCase();
  return {
    content: [{ type: 'text', text: `${path} (${ext})\n${result.value}` }],
    metadata: { type: 'docx' },
  };
}

/**
 * 读取旧版 OLE Word 文件（.doc），用 word-extractor 提取。
 * 正文之外，脚注/页眉页脚非空时附加输出。
 */
async function readLegacyDoc(path: string): Promise<ToolResult> {
  // CJS 包（module.exports = 构造函数），经 default 互操作获取
  const mod = await import('word-extractor');
  const WordExtractor = mod.default;
  const extractor = new WordExtractor();
  const buf = readFileSync(path);
  const doc = await extractor.extract(buf);

  const sections: string[] = [doc.getBody()];
  const footnotes = doc.getFootnotes();
  if (footnotes && footnotes.trim()) {
    sections.push(`\n--- Footnotes ---\n${footnotes}`);
  }
  const headers = doc.getHeaders();
  if (headers && headers.trim()) {
    sections.push(`\n--- Headers & Footers ---\n${headers}`);
  }

  return {
    content: [{ type: 'text', text: `${path} (DOC)\n${sections.join('\n')}` }],
    metadata: { type: 'doc' },
  };
}

/**
 * 读取 Excel 文件（xls/xlsx/xlsm/xltx/xltm），用 xlsx 库转为 CSV 格式，每个工作表分块展示。
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

  const ext = extname(path).toLowerCase().slice(1).toUpperCase();
  return {
    content: [{ type: 'text', text: `${path} (${ext})\n${lines.join('\n')}` }],
    metadata: { type: 'xlsx', sheets: wb.SheetNames.length },
  };
}

/**
 * 读取 PPT OOXML / OpenDocument / RTF 文件，用 officeparser 提取文本。
 * PPTX 含演讲者备注（officeparser 默认 ignoreNotes=false）。
 */
async function readWithOfficeParser(path: string, ext: string): Promise<ToolResult> {
  // officeparser 顶层命名导出 parseOffice（= OfficeParser.parseOffice 静态方法别名）
  const { parseOffice } = await import('officeparser');

  const buf = readFileSync(path);
  const ast = await parseOffice(buf);
  const text = ast.toText();

  const label = ext.slice(1).toUpperCase();
  return {
    content: [{ type: 'text', text: `${path} (${label})\n${text}` }],
    metadata: { type: label.toLowerCase() },
  };
}
