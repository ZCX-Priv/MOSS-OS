// src/modules/context/file-index/shared/watcher.ts
// 文件系统监听：fs.watch(recursive) 实时捕获变更（Windows/macOS 原生支持；
// Linux 无 recursive → 捕获后退化为 30s 定时增量扫描兜底）。
// 事件 200ms 防抖聚合，产出受影响的相对路径批次（引擎侧 diff 成 added/modified/removed）。

import { watch, type FSWatcher } from 'node:fs';
import { shouldIgnorePath, type IgnoreGlobs } from './ignore';

export interface WatcherCallbacks {
  /** 防抖聚合后的变更路径批次（相对 root 的正斜杠路径） */
  onBatch: (relPaths: string[]) => void;
  /** watcher 异常（用于日志） */
  onError?: (err: Error) => void;
}

const DEBOUNCE_MS = 200;
/** Linux 兜底扫描间隔 */
const FALLBACK_SCAN_INTERVAL_MS = 30_000;

export class ProjectWatcher {
  private watcher: FSWatcher | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private pending = new Set<string>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly root: string,
    private readonly customIgnore: IgnoreGlobs | null,
    private readonly cb: WatcherCallbacks,
  ) {}

  /** 启动监听；返回是否使用了原生 recursive watch */
  start(): boolean {
    try {
      this.watcher = watch(this.root, { recursive: true }, (event, filename) => {
        if (this.stopped || !filename) return;
        // filename 是相对 watch 根的路径（Windows 常带反斜杠；罕见场景为 Buffer）
        const raw = typeof filename === 'string' ? filename : Buffer.from(filename).toString('utf8');
        const rel = raw.split('\\').join('/');
        if (!rel || rel.startsWith('..')) return;
        if (shouldIgnorePath(rel, this.customIgnore)) return;
        this.pending.add(rel);
        this.scheduleFlush();
      });
      this.watcher.on('error', err => {
        this.cb.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
      return true;
    } catch {
      // Linux: recursive 不支持 → 定时扫描兜底
      this.startFallback();
      return false;
    }
  }

  /** 定时兜底（亦作为 recursive watch 失效后的降级） */
  private startFallback(): void {
    this.fallbackTimer = setInterval(() => {
      if (this.stopped) return;
      // 空批次触发引擎侧主动全量增量扫描（引擎 onBatch 收到 [] 时执行 scanIncremental）
      this.cb.onBatch([]);
    }, FALLBACK_SCAN_INTERVAL_MS);
  }

  private scheduleFlush(): void {
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.stopped || this.pending.size === 0) return;
      const batch = [...this.pending];
      this.pending.clear();
      this.cb.onBatch(batch);
    }, DEBOUNCE_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    try {
      this.watcher?.close();
    } catch {
      // 忽略关闭异常
    }
    this.watcher = null;
    this.pending.clear();
  }
}
