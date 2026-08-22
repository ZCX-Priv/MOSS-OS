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
 * JSON.stringify 输出不含裸换行（字符串内换行转义为 \n 两字符），
 * 每行一条天然成立——不做任何额外转义（旧版 replace 会破坏 Windows 路径
 * 与 diff 字段的 JSON 结构，导致条目读取时被静默丢弃）。
 */
export function appendEntry(transcriptPath: string, entry: FileHistoryEntry): void {
  try {
    mkdirSync(dirname(transcriptPath), { recursive: true });
  } catch (err) {
    throw new Error(`transcript: failed to mkdir ${dirname(transcriptPath)}: ${err instanceof Error ? err.message : err}`);
  }
  try {
    const line = JSON.stringify(entry);
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
      // 直接 JSON.parse：行内容即 stringify 产物（旧版 replace(/\\n/g) 会把
      // diff 转义换行与 Windows 路径中的 \n 模式还原成裸换行，破坏 JSON）
      const entry = JSON.parse(line) as FileHistoryEntry;
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
      const lines = remaining.map(e => JSON.stringify(e)).join('\n') + '\n';
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

/** 活跃条目判定：非 R 条目（toolName!=='rollback'）且未被撤回回滚（无 rolledBackAt 标记） */
export function isActiveEntry(e: FileHistoryEntry): boolean {
  return e.toolName !== 'rollback' && !e.rolledBackAt;
}

/**
 * 只读最后 N 条活跃条目（时间倒序，最近的在前），不物理移除。
 * 用于 undo：先 peek 再逐条恢复，恢复成功才 removeEntryById（失败条目保留可重试）。
 */
export function peekActiveEntries(transcriptPath: string, n: number): FileHistoryEntry[] {
  if (n <= 0) return [];
  const entries = readEntries(transcriptPath);
  const active = entries.filter(isActiveEntry);
  const take = Math.min(n, active.length);
  return active.slice(active.length - take).reverse();
}

/**
 * 批量给条目打 rolledBackAt 标记（消息撤回回滚成功后调用，标记制：不物理删除）。
 * 原子重写；无命中时不落盘。
 */
export function markEntriesRolledBack(transcriptPath: string, entryIds: Set<string>, at: string): void {
  if (entryIds.size === 0) return;
  const entries = readEntries(transcriptPath);
  let changed = false;
  for (const e of entries) {
    if (entryIds.has(e.id) && e.rolledBackAt !== at) {
      e.rolledBackAt = at;
      changed = true;
    }
  }
  if (changed) rewriteEntries(transcriptPath, entries);
}

/**
 * 批量清除 rolledBackAt 标记（redo 恢复成功后调用）。
 * 原子重写；undefined 字段序列化时自然省略（JSONL 向后兼容）；无命中时不落盘。
 */
export function clearRolledBackMarks(transcriptPath: string, entryIds: Set<string>): void {
  if (entryIds.size === 0) return;
  const entries = readEntries(transcriptPath);
  let changed = false;
  for (const e of entries) {
    if (entryIds.has(e.id) && e.rolledBackAt) {
      e.rolledBackAt = undefined;
      changed = true;
    }
  }
  if (changed) rewriteEntries(transcriptPath, entries);
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
