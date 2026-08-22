// src/modules/file-history/transcript.ts
// JSONL append-only 持久化：每行一个 FileHistoryEntry。
// 路径：~/.moss/file-history/transcripts/<sessionId>.jsonl
// 支持：追加、读取全部、移除最后 N 条（undo）、按 id 单条/批量移除。
// 重写统一走 atomicWriteFile（tmp + fsync + rename），中断不损坏。

import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FileHistoryEntry } from './types';
import { atomicWriteFile } from '../../utils/fs-atomic';

/**
 * 追加一条历史记录到 transcript。
 * 文件或目录不存在时自动创建。
 */
export function appendEntry(transcriptPath: string, entry: FileHistoryEntry): void {
  try {
    mkdirSync(dirname(transcriptPath), { recursive: true });
  } catch (err) {
    throw new Error(`transcript: failed to mkdir ${dirname(transcriptPath)}: ${err instanceof Error ? err.message : err}`);
  }
  try {
    // 每条记录一行 JSON，确保 JSON.stringify 不含换行（替换 \n 为 \\n）
    const line = JSON.stringify(entry).replace(/\n/g, '\\n');
    appendFileSync(transcriptPath, line + '\n', 'utf8');
  } catch (err) {
    throw new Error(`transcript: failed to append ${transcriptPath}: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * 读取全部历史记录。
 * 文件不存在返回空数组。
 * 损坏的行（JSON 解析失败）跳过，不抛错（容错）。
 */
export function readEntries(transcriptPath: string): FileHistoryEntry[] {
  if (!existsSync(transcriptPath)) return [];
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  const entries: FileHistoryEntry[] = [];
  for (const line of lines) {
    try {
      // 反序列化：还原被转义的换行
      const json = line.replace(/\\n/g, '\n');
      const entry = JSON.parse(json) as FileHistoryEntry;
      entries.push(entry);
    } catch {
      // 跳过损坏行
    }
  }
  return entries;
}

/** 原子重写 transcript（剩余条目） */
function rewriteEntries(transcriptPath: string, remaining: FileHistoryEntry[]): void {
  try {
    if (remaining.length === 0) {
      // 全部移除：写空文件（保留文件存在，避免下次 append 时 mkdir）
      atomicWriteFile(transcriptPath, '', { fsync: true });
    } else {
      const lines = remaining
        .map(e => JSON.stringify(e).replace(/\n/g, '\\n'))
        .join('\n') + '\n';
      atomicWriteFile(transcriptPath, lines, { fsync: true });
    }
  } catch (err) {
    throw new Error(`transcript: failed to rewrite ${transcriptPath}: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * 公共原子重写入口：把整个 transcript 文件重写为给定条目列表。
 * 目录布局迁移（migrate.ts）重写 backupPath 前缀时复用，与 undo/restore
 * 的重写路径保持同一原子写语义。
 */
export function rewriteAllEntries(transcriptPath: string, entries: FileHistoryEntry[]): void {
  rewriteEntries(transcriptPath, entries);
}

/**
 * 移除最后 N 条记录，返回被移除的条目（按时间倒序，最近的在前）。
 * 用于 undo：取出后由 service 层从备份恢复文件内容。
 * @param transcriptPath transcript 文件路径
 * @param n 要移除的条数
 * @returns 被移除的条目数组（索引 0 是最近一次变更）
 */
export function removeLastNEntries(
  transcriptPath: string,
  n: number,
): FileHistoryEntry[] {
  const entries = readEntries(transcriptPath);
  if (entries.length === 0 || n <= 0) return [];

  const removeCount = Math.min(n, entries.length);
  const removed = entries.slice(entries.length - removeCount).reverse();
  const remaining = entries.slice(0, entries.length - removeCount);

  rewriteEntries(transcriptPath, remaining);
  return removed;
}

/**
 * 移除指定 ID 的记录（用于 restore 单个条目）。
 * @returns 被移除的条目（若存在）
 */
export function removeEntryById(
  transcriptPath: string,
  entryId: string,
): FileHistoryEntry | null {
  const entries = readEntries(transcriptPath);
  const idx = entries.findIndex(e => e.id === entryId);
  if (idx === -1) return null;

  const removed = entries[idx];
  const remaining = entries.filter(e => e.id !== entryId);
  rewriteEntries(transcriptPath, remaining);
  return removed;
}

/**
 * 批量移除指定 ID 集合的记录，返回被移除的条目（保持原时间顺序）。
 * 用于 rollbackRange（移除被回滚 entries）与 redoRollback（移除 rollback entries）。
 */
export function removeEntriesByIds(
  transcriptPath: string,
  entryIds: Set<string>,
): FileHistoryEntry[] {
  if (entryIds.size === 0) return [];
  const entries = readEntries(transcriptPath);
  const removed = entries.filter(e => entryIds.has(e.id));
  const remaining = entries.filter(e => !entryIds.has(e.id));
  rewriteEntries(transcriptPath, remaining);
  return removed;
}
