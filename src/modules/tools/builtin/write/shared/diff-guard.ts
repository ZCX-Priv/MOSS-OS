// write/shared/diff-guard.ts
// diff 守卫：基于字节阈值判断是否跳过 diff，并决定是否读取 oldContent。
// 核心防爆内存点：大文件跳过 diff 时完全不读 oldContent，避免 content + oldContent + dp 矩阵叠加。
// 与 file-history/diff.ts 的 MAX_DIFF_LINES=5000（行维度）互为补充，先字节后行数。

import { readFileSync } from 'node:fs';

/** 字节维度 diff 跳过阈值：1MB（对应约 1-2 万行代码，超过则跳过 diff 且不读 oldContent） */
export const DIFF_SKIP_BYTES = 1 * 1024 * 1024;

/**
 * 判断是否应跳过 diff（基于写入内容字节大小）。
 * 超过 DIFF_SKIP_BYTES 则跳过，避免 computeLineDiff 的 O(n*m) 矩阵和 oldContent 全量读取。
 */
export function shouldSkipDiff(contentBytes: number): boolean {
  return contentBytes > DIFF_SKIP_BYTES;
}

/**
 * 读取旧文件内容用于 diff 计算。
 * - 文件不存在（新建场景）：返回 null，无需 diff
 * - 跳过 diff（大文件）：返回 null，不读 oldContent（防爆内存核心点）
 * - 否则：读取并返回旧内容（用于 computeLineDiff）
 *
 * @param absPath 文件绝对路径
 * @param fileExists 文件是否已存在
 * @param contentBytes 写入内容的字节大小
 * @returns 旧内容字符串或 null
 */
export function readOldContentForDiff(
  absPath: string,
  fileExists: boolean,
  contentBytes: number,
): string | null {
  // 新建文件无 oldContent
  if (!fileExists) return null;
  // 大文件跳过 diff，不读 oldContent（防爆内存）
  if (shouldSkipDiff(contentBytes)) return null;
  // 读取旧内容用于 diff（readFileSync 失败返回 null，降级为无 diff）
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}
