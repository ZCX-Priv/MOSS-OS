// src/utils/fs.ts
// 安全文件操作：路径解析、防越权、二进制检测。

import { t } from '../core/i18n';
import { resolve, normalize, isAbsolute, relative, sep, parse, dirname, join } from 'node:path';
import { existsSync, statSync, readFileSync, realpathSync } from 'node:fs';
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
  return rel === '' || (!rel.startsWith('..' + sep) && !isAbsolute(rel));
}

/**
 * 更严格的越权检测：返回值用于决定是否允许访问。
 * 允许 base 自身和其下所有子路径；禁止 ../ 跳出。
 */
export function assertPathInside(path: string, base: string): void {
  if (!isPathInside(path, base)) {
    throw new Error(t('fs.pathEscapesBase', { path, base }));
  }
}

/**
 * 解析工作目录下的路径并做严格隔离。
 *  - 相对路径基于 cwd 解析，绝对路径直接使用
 *  - 标准化后必须位于 cwd（含 cwd 自身）之内
 *  - 越出 cwd 返回 null（调用方应拒绝访问）
 */
export function resolveWithinCwd(path: string, cwd: string): string | null {
  const base = cwd || process.cwd();
  const abs = isAbsolute(path) ? normalize(path) : normalize(resolve(base, path));
  if (!isPathInside(abs, base)) return null;
  return abs;
}

/**
 * 文件内容分类（用于 read 工具的编码/二进制判定）。
 * - 'utf8'：合法 UTF-8 文本（含纯 ASCII、中文等多字节字符）
 * - 'legacy-text'：非 UTF-8 但不含 NUL 字节 —— GBK 等传统编码文本的候选，
 *   可安全尝试 GBK 回退解码（真正的 GBK 文本不含 NUL）
 * - 'binary'：含 NUL 字节的二进制 —— 强信号，禁止任何编码回退解码，
 *   否则 OLE/ZIP 等二进制经 GBK 随机解出汉字会被误判为文本（乱码根源）
 */
export type FileContentKind = 'utf8' | 'legacy-text' | 'binary';

/**
 * 读取文件前 8KB 采样并分类内容类型。
 * 分类依据（第一性原理）：
 * 1. NUL 字节是二进制的强信号，任何真实编码的文本文件都不会包含 NUL
 * 2. 合法 UTF-8 视为文本（旧版 30% 非可打印比例阈值会误判纯中文 UTF-8，
 *    中文字节全在 0x80-0xff，比例轻松超 60%，故用严格 UTF-8 字节级验证）
 * 3. 无 NUL 的非 UTF-8 才有资格做 GBK 回退
 */
export function classifyFileContent(path: string, sampleSize = 8192): FileContentKind {
  const buf = readFileSync(path); // Buffer
  const sample = buf.length > sampleSize ? buf.subarray(0, sampleSize) : buf;
  if (sample.length === 0) return 'utf8';
  if (sample.includes(0)) return 'binary';
  return isValidUtf8(sample as Buffer) ? 'utf8' : 'legacy-text';
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

/**
 * 解析 symlink 到真实路径；解析失败（如目标已删除）回退到原路径。
 * 用于 symlink 遍历防护：cwd 内 symlink 若指向 cwd 外，realpath 会暴露真实位置。
 */
export function realpathSafe(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * 检测路径是否为驱动器根或文件系统根。
 * Windows 如 C:\、D:\；POSIX 如 /。
 * 用于 Windows 路径折叠防护：拒绝删除根级路径，防止 rmdir /s /q 灾难。
 */
export function isRootPath(p: string): boolean {
  const normalized = normalize(p);
  // POSIX 根
  if (normalized === sep) return true;
  // Windows 驱动器根：C:\、D:\ 等（parse 后 dir === root 且 base 为空）
  const { root, dir, base } = parse(normalized);
  return root !== '' && dir === root && base === '';
}

const VCS_MARKERS = ['.git', '.svn', '.hg'];

/**
 * 检测路径本身或其任一祖先目录是否含 VCS 标记目录（.git/.svn/.hg）。
 * 用于 dev vault 防护：拒绝删除版本控制仓库根目录，防止误删项目仓库。
 */
export function containsVcsMarker(absPath: string): boolean {
  let current = normalize(absPath);
  let prev = '';
  while (current !== prev) {
    for (const marker of VCS_MARKERS) {
      if (existsSync(join(current, marker))) return true;
    }
    prev = current;
    current = dirname(current);
  }
  return false;
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
