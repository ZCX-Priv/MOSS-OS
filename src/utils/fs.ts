// src/utils/fs.ts
// 安全文件操作：路径解析、防越权、二进制检测。

import { resolve, normalize, isAbsolute, relative, sep } from 'node:path';
import { existsSync, statSync, readFileSync } from 'node:fs';

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
    throw new Error(`Path "${path}" escapes base directory "${base}"`);
  }
}

/**
 * 检测文件是否为二进制（非文本）。
 * 启发式：读取前 8KB，若包含 NUL 字节或大量非可打印字符则视为二进制。
 */
export function isBinaryFile(path: string, sampleSize = 8192): boolean {
  const fd = readFileSync(path); // Buffer
  const sample = fd.length > sampleSize ? fd.subarray(0, sampleSize) : fd;
  // NUL 字节是二进制的强信号
  if (sample.includes(0)) return true;
  // 统计非可打印（非 ASCII 文本）比例
  let nonText = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    // 允许 \t \n \r
    if (b === 0x09 || b === 0x0a || b === 0x0d) continue;
    // 允许 ASCII 可打印范围 0x20-0x7e
    if (b < 0x20 || b > 0x7e) {
      // 允许 UTF-8 高字节（0x80-0xff），但若比例过高视为二进制
      nonText++;
    }
  }
  // 阈值 30%
  return sample.length > 0 && nonText / sample.length > 0.3;
}

/**
 * 读取文件前 N 行，带行号。
 */
export function readLinesWithNumbers(
  path: string,
  offset = 1,
  limit = 2000,
): { text: string; totalLines: number; returnedLines: number } {
  const content = readFileSync(path, 'utf8');
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
