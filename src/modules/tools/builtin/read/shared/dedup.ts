// read/shared/dedup.ts
// Dedup 去重：进程级 Map 记录已读文件的 mtime，相同则返回 unchanged 标记。
// 避免同一文件在单次会话中被重复全量发送给 LLM，节省上下文。
// 注：Map 是进程级缓存，不持久化（read-only 工具无需跨会话）。

/** 单条缓存记录 */
interface DedupEntry {
  /** 文件最后修改时间（毫秒） */
  mtimeMs: number;
}

/** 进程级读取缓存：path → mtimeMs */
const readCache = new Map<string, DedupEntry>();

/** Dedup 检查结果 */
export interface DedupResult {
  /** true 表示文件自上次读取后未变化，可跳过全量返回 */
  unchanged: boolean;
}

/**
 * 检查文件是否自上次读取后未变化。
 * 未变化返回 unchanged:true；首次读取或已变化则更新缓存并返回 unchanged:false。
 */
export function checkDedup(path: string, mtimeMs: number): DedupResult {
  const prev = readCache.get(path);
  if (prev && prev.mtimeMs === mtimeMs) {
    return { unchanged: true };
  }
  readCache.set(path, { mtimeMs });
  return { unchanged: false };
}

/** 清除指定文件的缓存（供测试或强制重读使用） */
export function clearDedup(path: string): void {
  readCache.delete(path);
}
