// read/shared/detector.ts
// 文件类型检测：根据扩展名判断文件类型，路由到对应 handler。
// detector 只做快速分派，二进制兜底检测由 text handler 负责。

import { extname } from 'node:path';

/** 文件类型分类，决定分派到哪个 handler */
export type FileType = 'text' | 'image' | 'pdf' | 'office' | 'notebook';

/** 图片扩展名集合 */
const IMAGE_EXTS = new Set<string>([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
]);

/** Office 文档扩展名集合 */
const OFFICE_EXTS = new Set<string>([
  '.docx', '.xlsx', '.xlsm', '.pptx',
]);

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
  return 'text';
}
