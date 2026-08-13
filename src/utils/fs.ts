// src/utils/fs.ts
// 安全文件操作：路径解析、防越权、二进制检测。

import { t } from '../core/i18n';
import { resolve, normalize, isAbsolute, relative, sep } from 'node:path';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { isValidUtf8, stripBom } from './encoding';

/**
 * 解析工作目录下的路径：
 *  - 相对路径基于 cwd 解析
 *  - 绝对路径直接使用
 *  - 返回标准化后的绝对路径
 */
export function resolvePath(path: string, cwd: string): string {
  const base = cwd || process.cwd();
  return isAbsolute(path) ? normalize(path) : normalize(resolve(base, path));
}

/**
 * 路径越权检测：确保 path 在 base 目录内。
 * 返回 true 表示安全（在 base 内或等于 base）。
 */
export function isPathInside(path: string, base: string): boolean {
  const rel = relative(base, path);
  return rel === '' || (!rel.startsWith('..' + sep) && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}

/**
 * 更严格的越权检测：返回值用于决定是否允许访问。
 * 允许 base 自身和其下所有子路径；禁止 ../ 跳出。
 */
export function assertPathInside(path: string, base: string): void {
  const rel = relative(base, path);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(t('fs.pathEscapesBase', { path, base }));
  }
}

/**
 * 检测文件是否为二进制（非文本）。
 * 启发式：读取前 8KB，若包含 NUL 字节或大量非可打印字符则视为二进制。
 */
export function isBinaryFile(path: string, sampleSize = 8192): boolean {
  const fd = readFileSync(path); // Buffer
  const sample = fd.length > sampleSize ? fd.subarray(0, sampleSize) : fd;
  if (sample.length === 0) return false;
  // NUL 字节是二进制的强信号
  if (sample.includes(0)) return true;
  // 合法 UTF-8 视为文本（含中文等多字节字符）。
  // 旧版用 30% 非可打印比例阈值，会把纯中文 UTF-8 文件误判为二进制
  // （中文字节全在 0x80-0xff，nonText 比例轻松超 60%）。
  // 改用严格 UTF-8 字节级验证：合法 UTF-8 即文本，否则视为二进制。
  return !isValidUtf8(sample as Buffer);
}

/**
 * 读取文件前 N 行，带行号。
 */
export function readLinesWithNumbers(
  path: string,
  offset = 1,
  limit = 2000,
): { text: string; totalLines: number; returnedLines: number } {
  // 读取后剥离 UTF-8 BOM，避免第一行行号后出现不可见字符 \uFEFF
  const content = stripBom(readFileSync(path, 'utf8'));
  const allLines = content.split('\n');
  const totalLines = allLines.length;
  const start = Math.max(0, offset - 1);
  const end = Math.min(allLines.length, start + limit);
  const slice = allLines.slice(start, end);
  const maxLineNumWidth = String(end).length;
  const text = slice
    .map((line, idx) => {
      const lineNum = String(start + idx + 1).padStart(maxLineNumWidth, ' ');
      return `${lineNum}→${line}`;
    })
    .join('\n');
  return { text, totalLines, returnedLines: slice.length };
}

export function fileStats(path: string): { size: number; isDir: boolean; mtime: Date } | null {
  try {
    const s = statSync(path);
    return { size: s.size, isDir: s.isDirectory(), mtime: s.mtime };
  } catch {
    return null;
  }
}

export { existsSync };
