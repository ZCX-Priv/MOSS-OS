// read/shared/detector.ts
// 文件类型检测：根据扩展名判断文件类型，路由到对应 handler。
// detector 只做快速分派，二进制兜底检测由 text handler 负责。

import { extname } from 'node:path';

/** 文件类型分类，决定分派到哪个 handler */
export type FileType = 'text' | 'image' | 'pdf' | 'office' | 'notebook' | 'ebook';

/** 图片扩展名集合 */
const IMAGE_EXTS = new Set<string>([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
]);

/**
 * Office/文档扩展名集合。
 * - Word OOXML：.docx/.docm/.dotx；Word OLE 旧版：.doc（word-extractor 解析）
 * - Excel OOXML：.xlsx/.xlsm/.xltx/.xltm；Excel OLE 旧版：.xls（SheetJS 原生支持读）
 * - PPT OOXML：.pptx/.pptm/.potx/.ppsx（officeparser）；PPT OLE 旧版：.ppt（不支持，报错提示转换）
 * - OpenDocument：.odt/.ods/.odp；RTF（officeparser）
 * 未列出的扩展名回退 'text'，由 text handler 做二进制兜底检测。
 */
const OFFICE_EXTS = new Set<string>([
  // Word
  '.docx', '.docm', '.dotx', '.doc',
  // Excel
  '.xlsx', '.xlsm', '.xltx', '.xltm', '.xls',
  // PowerPoint
  '.pptx', '.pptm', '.potx', '.ppsx', '.ppt',
  // OpenDocument / RTF
  '.odt', '.ods', '.odp', '.rtf',
]);

/**
 * 电子书扩展名集合。
 * - EPUB：.epub/.opf（jszip + OPF spine 解析）
 * - FB2：.fb2（XML，cheerio 解析）
 * - MOBI/AZW3：.mobi/.azw3/.azw（无纯 JS 解析方案，handler 内明确报错提示转换）
 */
const EBOOK_EXTS = new Set<string>(['.epub', '.opf', '.mobi', '.azw3', '.azw', '.fb2']);

/**
 * 根据扩展名检测文件类型。
 * 默认回退为 'text'，由 text handler 做二进制检测兜底
 * （避免将 GBK 编码的 .txt 误判为二进制而拒绝）。
 */
export function detectFileType(path: string): FileType {
  const ext = extname(path).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.ipynb') return 'notebook';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (OFFICE_EXTS.has(ext)) return 'office';
  if (EBOOK_EXTS.has(ext)) return 'ebook';
  return 'text';
}
