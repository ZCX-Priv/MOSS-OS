// src/modules/file-history/migrate.ts
// 一次性目录布局迁移（幂等，可重入）：统一 .moss 内文件历史存储。
//   ~/.moss/backups/             → ~/.moss/file-history/backups/
//   ~/.moss/trash/               → ~/.moss/file-history/trash/
//   ~/.moss/ledger/              → ~/.moss/file-history/ledger/
//   ~/.moss/file-history/*.jsonl → ~/.moss/file-history/transcripts/*.jsonl
//     （移入后重写其中 backupPath 的旧绝对路径前缀，保证旧 undo/restore 历史可用）
// 旧位置不存在则跳过（二次启动零 IO）；单项失败记 warn 不阻断启动。

import {
  existsSync,
  readdirSync,
  renameSync,
  mkdirSync,
  statSync,
  rmSync,
} from 'node:fs';
import { dirname, join, sep } from 'node:path';
import type { Logger, Environment } from '../../core/types';
import { readEntries, rewriteAllEntries } from './transcript';

export interface MigrationResult {
  /** 成功迁入根目录的旧平级目录名（backups/trash/ledger） */
  movedDirs: string[];
  /** 迁入 transcripts/ 的 .jsonl 文件数 */
  movedTranscripts: number;
  /** backupPath 旧前缀被重写的 transcript 条目数 */
  rewroteEntries: number;
  /** 跳过项（新旧并存时目标已存在的文件等） */
  skipped: string[];
}

/** 需要整体迁入根目录的旧平级目录 */
const LEGACY_DIRS = ['backups', 'trash', 'ledger'] as const;

/**
 * 路径前缀替换：p 以 oldPrefix（+ 路径分隔符）开头时替换为 newPrefix，其余部分原样保留。
 * 大小写与分隔符方向归一化后比较（兼容历史 JSONL 中 / 与 \ 混存、盘符大小写差异）；
 * 边界要求前缀后紧跟分隔符或恰好结束，避免误伤相似前缀目录（如 backups2）。
 * 不匹配返回 null。
 */
function replaceDirPrefix(p: string, oldPrefix: string, newPrefix: string): string | null {
  const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase();
  const np = norm(p);
  const no = norm(oldPrefix);
  if (np === no) return newPrefix;
  if (np.startsWith(`${no}/`)) {
    // 归一化不改变长度（\ → / 与 toLowerCase 均 1:1），slice 精确保留前缀之后的剩余部分；
    // 首个分隔符统一为平台分隔符，避免产出 / 与 \ 混合的路径形态
    const rest = p.slice(oldPrefix.length).replace(/^[\\/]/, '');
    return newPrefix + sep + rest;
  }
  return null;
}

/** 重写单个 transcript 文件中所有条目的 backupPath 旧前缀，返回重写条数（无变更不落盘） */
function rewriteTranscriptBackupPaths(
  transcriptPath: string,
  oldBackupDir: string,
  newBackupDir: string,
): number {
  const entries = readEntries(transcriptPath);
  let rewritten = 0;
  for (const entry of entries) {
    if (!entry.backupPath) continue;
    const replaced = replaceDirPrefix(entry.backupPath, oldBackupDir, newBackupDir);
    if (replaced && replaced !== entry.backupPath) {
      entry.backupPath = replaced;
      rewritten++;
    }
  }
  if (rewritten > 0) {
    rewriteAllEntries(transcriptPath, entries);
  }
  return rewritten;
}

/**
 * 旧目录并入新目录：
 * - 目标不存在 → renameSync 整体搬移（同盘零拷贝，O(1)）
 * - 新旧并存（上次迁移中断/用户手动干预）→ 逐项搬移，同名保留新位置版本并记 skipped
 * 搬移后旧目录已空则移除；仍有残留（跳过项）则保留，下次启动继续幂等处理。
 */
function mergeMoveDir(
  oldDir: string,
  newDir: string,
  name: string,
  result: MigrationResult,
): void {
  mkdirSync(dirname(newDir), { recursive: true });
  if (!existsSync(newDir)) {
    renameSync(oldDir, newDir);
    result.movedDirs.push(name);
    return;
  }
  for (const ent of readdirSync(oldDir)) {
    const src = join(oldDir, ent);
    const dest = join(newDir, ent);
    if (existsSync(dest)) {
      result.skipped.push(`${name}/${ent}`);
      continue;
    }
    renameSync(src, dest);
  }
  try {
    rmSync(oldDir, { recursive: false });
  } catch {
    // 目录非空（存在跳过项），保留待下次处理
  }
  result.movedDirs.push(name);
}

/**
 * 执行一次性目录布局迁移（幂等）。
 * 在 FileHistoryModule.initialize 中、FileHistoryService 构造之前调用：
 * 服务各目录字段直接指向新布局路径，迁移必须先行完成。
 */
export function migrateLegacyLayout(
  env: Pick<Environment, 'dataDir'>,
  logger: Logger,
): MigrationResult {
  const result: MigrationResult = {
    movedDirs: [],
    movedTranscripts: 0,
    rewroteEntries: 0,
    skipped: [],
  };
  const root = join(env.dataDir, 'file-history');
  const oldBackupDir = join(env.dataDir, 'backups');
  const newBackupDir = join(root, 'backups');

  // 1. 三个旧平级目录并入 root/<name>
  for (const name of LEGACY_DIRS) {
    const oldDir = join(env.dataDir, name);
    if (!existsSync(oldDir)) continue; // 未装过旧版或已迁移
    try {
      mergeMoveDir(oldDir, join(root, name), name, result);
    } catch (err) {
      logger.warn('file-history: legacy dir migration failed', {
        dir: name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. root 下散落的 *.jsonl（旧布局 transcript 位置）移入 transcripts/
  if (existsSync(root)) {
    let rootEntries: string[] = [];
    try {
      rootEntries = readdirSync(root);
    } catch (err) {
      logger.warn('file-history: read file-history root failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const transcriptsDir = join(root, 'transcripts');
    for (const ent of rootEntries) {
      const src = join(root, ent);
      try {
        if (!statSync(src).isFile() || !ent.endsWith('.jsonl')) continue;
        const dest = join(transcriptsDir, ent);
        if (existsSync(dest)) {
          // transcripts/ 已有同名文件（新布局已写入）：保留新版本，旧文件留在原地待人工处理
          result.skipped.push(ent);
          continue;
        }
        mkdirSync(transcriptsDir, { recursive: true });
        renameSync(src, dest);
        result.movedTranscripts++;
        // backupPath 前缀重写（undo/restore 依赖备份路径可达，字符串替换不依赖文件存在）
        result.rewroteEntries += rewriteTranscriptBackupPaths(
          dest,
          oldBackupDir,
          newBackupDir,
        );
      } catch (err) {
        logger.warn('file-history: transcript migration failed', {
          file: ent,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return result;
}
