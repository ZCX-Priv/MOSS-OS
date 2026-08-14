// src/modules/file-history/types.ts
// 三层文件历史架构类型定义。
// Layer 1: Track Edit（改前备份，同步阻塞）
// Layer 2: Snapshot（每轮 LLM 响应后异步快照）
// Layer 3: JSONL Transcript（append-only 持久化，支持 undo）

/** 文件变更操作类型 */
export type FileOperation = 'create' | 'overwrite' | 'edit' | 'delete';

/** 触发变更的工具名 */
export type HistoryToolName = 'write' | 'edit' | 'delete';

/**
 * 文件历史条目（JSONL 中每行一个）。
 * 每次文件变更前由 trackEdit 写入一条。
 */
export interface FileHistoryEntry {
  /** 条目唯一 ID（UUID） */
  id: string;
  /** 所属会话 ID */
  sessionId: string;
  /** 文件绝对路径 */
  absPath: string;
  /** 触发变更的工具调用 ID */
  toolCallId: string;
  /** 触发变更的工具名 */
  toolName: HistoryToolName;
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** 变更操作类型 */
  operation: FileOperation;
  /** 变更前内容 sha256（新文件为 null） */
  hashBefore: string | null;
  /** 变更后内容 sha256（删除为 null） */
  hashAfter: string | null;
  /** 备份文件路径（新文件为 null） */
  backupPath: string | null;
  /** 变更前文件大小（字节，新文件为 0） */
  bytesBefore: number;
  /** 变更后文件大小（字节，删除为 0） */
  bytesAfter: number;
  /** unified diff 文本（仅 overwrite/edit，可选） */
  diff?: string;
}

/** trackEdit 返回结果 */
export interface TrackEditResult {
  /** 是否实际备份了（文件不存在或已在快照中则 false） */
  backedUp: boolean;
  /** 备份路径（~/.moss/backups/<hash>.bak） */
  backupPath: string | null;
  /** 原内容 sha256（新文件为空字符串） */
  hash: string;
  /** 原文件大小（字节，新文件为 0） */
  bytesBefore: number;
  /** 历史条目 ID（用于 restore） */
  entryId: string;
  /** 变更操作类型 */
  operation: FileOperation;
}

/** undo 返回结果 */
export interface UndoResult {
  /** 已恢复的文件路径列表 */
  restored: string[];
  /** 剩余可撤销的历史条目数 */
  remaining: number;
  /** 撤销失败的条目（含错误信息） */
  failed: Array<{ entryId: string; absPath: string; error: string }>;
}

/** 文件历史服务配置（config.fileHistory） */
export interface FileHistoryConfig {
  /** 全局开关，false 时所有工具的 trackHistory 行为被忽略 */
  enabled: boolean;
  /** 单文件最多保留 N 个备份（超出 LRU 清理） */
  maxBackupsPerFile: number;
  /** 是否写 JSONL transcript（false 时仅内存，重启丢失 undo 能力） */
  transcriptEnabled: boolean;
  /** 备份文件保留天数（启动时清理过期） */
  backupRetentionDays: number;
}

export const DEFAULT_FILE_HISTORY_CONFIG: FileHistoryConfig = {
  enabled: true,
  maxBackupsPerFile: 10,
  transcriptEnabled: true,
  backupRetentionDays: 30,
};
