// src/modules/file-history/service.ts
// FileHistoryService 实现：组装 backup / ledger / transcript / atomic-write / diff。
// 三层架构：
//   Layer 1 (Track Edit)：trackEdit 改前备份，同步阻塞
//   Layer 2 (Snapshot)：createSnapshot 每轮快照（当前 no-op，预留）
//   Layer 3 (Transcript)：recordChange 写 JSONL，undo 读 JSONL 恢复

import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { existsSync, unlinkSync, statSync, rmSync } from 'node:fs';
import type { Logger, Environment } from '../../core/types';
import type { FileHistoryService } from '../contracts';
import type {
  FileHistoryEntry,
  TrackEditResult,
  UndoResult,
  FileHistoryConfig,
  FileOperation,
} from './types';
import { backupByHash, readBackup } from './backup';
import { ReadLedger } from './ledger';
import { appendEntry, readEntries, removeLastNEntries, removeEntryById } from './transcript';
import { atomicWriteFile } from './atomic-write';
import { archiveDirectory, extractArchive } from './archive';
import { cleanupExpiredTrash, TRASH_RETENTION_DAYS } from './trash';

export class FileHistoryServiceImpl implements FileHistoryService {
  private readonly ledger = new ReadLedger();
  private readonly backupDir: string;
  private readonly transcriptDir: string;
  private readonly trashDir: string;

  constructor(
    private readonly env: Environment,
    private readonly logger: Logger,
    private readonly config: FileHistoryConfig,
  ) {
    this.backupDir = join(env.dataDir, 'backups');
    this.transcriptDir = join(env.dataDir, 'file-history');
    this.trashDir = join(env.dataDir, 'trash');
  }

  /** 全局开关：config.fileHistory.enabled 为 false 时所有行为降级为 no-op */
  private get enabled(): boolean {
    return this.config.enabled;
  }

  /** 获取某会话的 transcript 文件路径 */
  private transcriptPath(sessionId: string): string {
    // 防路径注入：sessionId 只允许字母数字-_（UUID 天然符合）
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
    return join(this.transcriptDir, `${safe}.jsonl`);
  }

  async trackEdit(
    sessionId: string,
    absPath: string,
    toolCallId: string,
    toolName: 'write' | 'edit' | 'delete',
  ): Promise<TrackEditResult> {
    if (!this.enabled) {
      // 全局禁用：返回空结果，不备份不记录
      return {
        backedUp: false,
        backupPath: null,
        hash: '',
        bytesBefore: 0,
        entryId: '',
        operation: 'create',
      };
    }

    const entryId = randomUUID();

    // 文件/目录不存在 → create 操作，无需备份
    if (!existsSync(absPath)) {
      return {
        backedUp: false,
        backupPath: null,
        hash: '',
        bytesBefore: 0,
        entryId,
        operation: 'create',
      };
    }

    const stat = statSync(absPath);
    const operation: FileOperation = toolName === 'delete' ? 'delete' : toolName === 'edit' ? 'edit' : 'overwrite';

    // 目录 → tar.gz 整体归档备份（支持 undo 解包恢复）
    if (stat.isDirectory()) {
      const archivePath = join(this.backupDir, `${entryId}.tar.gz`);
      try {
        const result = await archiveDirectory(absPath, archivePath);
        this.logger.debug('file-history: trackEdit directory archived', {
          sessionId,
          absPath,
          operation,
          archivePath: result.archivePath,
          bytes: result.bytes,
        });
        return {
          backedUp: true,
          backupPath: result.archivePath,
          hash: '', // 目录归档无内容哈希
          bytesBefore: result.bytes,
          entryId,
          operation,
          isDirectory: true,
        };
      } catch (err) {
        this.logger.warn('file-history: directory archive failed', {
          absPath,
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          backedUp: false,
          backupPath: null,
          hash: '',
          bytesBefore: 0,
          entryId,
          operation,
          isDirectory: true,
        };
      }
    }

    // 文件 → 按内容哈希备份（同内容去重）
    let backup;
    try {
      backup = backupByHash(absPath, this.backupDir);
    } catch (err) {
      // 备份失败：记录错误但不阻断工具执行（文件变更仍可进行，但 undo 不可用）
      this.logger.warn('file-history: backup failed', {
        absPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        backedUp: false,
        backupPath: null,
        hash: '',
        bytesBefore: stat.size,
        entryId,
        operation,
      };
    }

    this.logger.debug('file-history: trackEdit', {
      sessionId,
      absPath,
      operation,
      hash: backup.hash,
      bytes: backup.bytes,
      backedUp: backup.created,
    });

    return {
      backedUp: backup.created,
      backupPath: backup.backupPath,
      hash: backup.hash,
      bytesBefore: backup.bytes,
      entryId,
      operation,
    };
  }

  recordChange(
    sessionId: string,
    absPath: string,
    trackResult: TrackEditResult,
    hashAfter: string,
    bytesAfter: number,
    diff?: string,
  ): void {
    if (!this.enabled) return;
    if (!trackResult.entryId) return; // trackEdit 被禁用或失败

    if (!this.config.transcriptEnabled) return;

    const entry: FileHistoryEntry = {
      id: trackResult.entryId,
      sessionId,
      absPath,
      toolCallId: '', // 调用方可覆盖，此处简化
      // 从 trackResult.operation 推断 toolName：delete 操作记 delete，否则按 hashAfter 判断 create/overwrite
      toolName: trackResult.operation === 'delete' ? 'delete' : 'write',
      timestamp: new Date().toISOString(),
      operation: trackResult.operation,
      hashBefore: trackResult.hash || null,
      hashAfter: hashAfter || null,
      backupPath: trackResult.backupPath,
      bytesBefore: trackResult.bytesBefore,
      bytesAfter,
      isDirectory: trackResult.isDirectory,
      ...(diff ? { diff } : {}),
    };

    try {
      appendEntry(this.transcriptPath(sessionId), entry);
    } catch (err) {
      this.logger.warn('file-history: recordChange failed', {
        sessionId,
        absPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  isRead(sessionId: string, absPath: string): boolean {
    return this.ledger.isRead(sessionId, absPath);
  }

  markRead(sessionId: string, absPath: string, sha: string): void {
    this.ledger.markRead(sessionId, absPath, sha);
  }

  async createSnapshot(_sessionId: string): Promise<void> {
    // Layer 2：当前实现为 no-op。
    // 预留扩展点：未来可在此为会话所有追踪文件创建完整快照（参考 Claude Code）。
    // 当前 undo 基于 transcript + 备份已足够，无需全量快照。
  }

  async undo(sessionId: string, steps = 1): Promise<UndoResult> {
    if (!this.enabled) {
      return { restored: [], remaining: 0, failed: [] };
    }

    const path = this.transcriptPath(sessionId);
    let removed: FileHistoryEntry[];
    try {
      removed = removeLastNEntries(path, steps);
    } catch (err) {
      this.logger.error('file-history: undo read transcript failed', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { restored: [], remaining: 0, failed: [] };
    }

    if (removed.length === 0) {
      const remaining = readEntries(path).length;
      return { restored: [], remaining, failed: [] };
    }

    const restored: string[] = [];
    const failed: Array<{ entryId: string; absPath: string; error: string }> = [];

    // 逆序处理（removed 已是倒序：最近在前）
    // 注意：removeLastNEntries 返回 reverse() 后的结果，索引 0 是最近一次
    for (const entry of removed) {
      try {
        await this.restoreEntry(entry);
        restored.push(entry.absPath);
        this.logger.info('file-history: undo restored', {
          sessionId,
          absPath: entry.absPath,
          operation: entry.operation,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        failed.push({ entryId: entry.id, absPath: entry.absPath, error: errMsg });
        this.logger.warn('file-history: undo failed for entry', {
          sessionId,
          absPath: entry.absPath,
          error: errMsg,
        });
      }
    }

    const remaining = readEntries(path).length;
    return { restored, remaining, failed };
  }

  listHistory(sessionId: string): FileHistoryEntry[] {
    return readEntries(this.transcriptPath(sessionId));
  }

  async restore(sessionId: string, entryId: string): Promise<UndoResult> {
    if (!this.enabled) {
      return { restored: [], remaining: 0, failed: [] };
    }

    const path = this.transcriptPath(sessionId);
    let entry: FileHistoryEntry | null;
    try {
      entry = removeEntryById(path, entryId);
    } catch (err) {
      this.logger.error('file-history: restore read transcript failed', {
        sessionId,
        entryId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { restored: [], remaining: 0, failed: [] };
    }

    if (!entry) {
      return { restored: [], remaining: readEntries(path).length, failed: [] };
    }

    try {
      await this.restoreEntry(entry);
      return { restored: [entry.absPath], remaining: readEntries(path).length, failed: [] };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        restored: [],
        remaining: readEntries(path).length,
        failed: [{ entryId: entry.id, absPath: entry.absPath, error: errMsg }],
      };
    }
  }

  clearSession(sessionId: string): void {
    this.ledger.clearSession(sessionId);
  }

  /**
   * 恢复单个历史条目（内部方法）。
   * - create：删除文件/目录（撤销创建）
   * - overwrite/edit/delete 文件：从备份原子写回原内容
   * - delete 目录：从 tar.gz 归档解包到原路径父目录
   */
  private async restoreEntry(entry: FileHistoryEntry): Promise<void> {
    if (entry.operation === 'create') {
      // 撤销创建：删除文件或目录
      if (existsSync(entry.absPath)) {
        const stat = statSync(entry.absPath);
        if (stat.isDirectory()) {
          rmSync(entry.absPath, { recursive: true, force: true });
        } else {
          unlinkSync(entry.absPath);
        }
      }
      return;
    }

    // overwrite/edit/delete：从备份恢复
    if (!entry.backupPath) {
      throw new Error('no backup available for this entry');
    }

    if (!existsSync(entry.backupPath)) {
      throw new Error(`backup file not found: ${entry.backupPath}`);
    }

    // 目录归档 → tar.gz 解包恢复
    if (entry.isDirectory || entry.backupPath.endsWith('.tar.gz')) {
      const parentDir = dirname(entry.absPath);
      // 若原路径已被占用，先移除（覆盖语义）
      if (existsSync(entry.absPath)) {
        const stat = statSync(entry.absPath);
        if (stat.isDirectory()) {
          rmSync(entry.absPath, { recursive: true, force: true });
        } else {
          unlinkSync(entry.absPath);
        }
      }
      await extractArchive(entry.backupPath, parentDir);
      return;
    }

    // 文件 → 从 .bak 哈希备份恢复
    const content = readBackup(entry.backupPath);
    // 原子写回原路径（不保留 BOM，因为备份的是原始完整内容）
    atomicWriteFile(entry.absPath, content, {
      fsync: true,
      preserveMode: true,
      preserveBom: false, // 备份内容已含 BOM（如有），不重复添加
      mode: 0o644,
    });
  }

  /**
   * 启动时清理过期备份（>backupRetentionDays 天）。
   * 简单实现：遍历 backups 目录，stat mtime 超期则删除。
   */
  cleanupExpiredBackups(): void {
    if (!this.enabled || this.config.backupRetentionDays <= 0) return;
    if (!existsSync(this.backupDir)) return;

    const cutoff = Date.now() - this.config.backupRetentionDays * 24 * 60 * 60 * 1000;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    let cleaned = 0;
    try {
      const entries = fs.readdirSync(this.backupDir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        const full = join(this.backupDir, ent.name);
        try {
          const stat = fs.statSync(full);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(full);
            cleaned++;
          }
        } catch {
          // 跳过单个文件失败
        }
      }
    } catch {
      // 目录读取失败，跳过
    }
    if (cleaned > 0) {
      this.logger.info('file-history: cleaned expired backups', { count: cleaned });
    }

    // 同时清理过期 trash 项（保留 TRASH_RETENTION_DAYS 天）
    try {
      const trashedRemoved = cleanupExpiredTrash(this.trashDir, TRASH_RETENTION_DAYS);
      if (trashedRemoved > 0) {
        this.logger.info('file-history: cleaned expired trash entries', { count: trashedRemoved });
      }
    } catch (err) {
      this.logger.warn('file-history: trash cleanup failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 暴露 trashDir 路径，供 delete 工具调用 moveToTrash */
  getTrashDir(): string {
    return this.trashDir;
  }
}
