// src/modules/filesys/shell-watch.ts
// shell 前后快照检测：shell 工具执行前后各做一次工作区 stat 清单（轻量，只 stat 不读内容），
// diff 出 created/modified/deleted 三分类，并对"读缓存持有执行前内容"的文件做回填备份，
// 使 shell 造成的文件变更（mv/rm/重定向等）纳入 file-history（可 undo / 可感知）。
//
// undo 三层降级（尽力而为，无法预知 shell 将改哪些文件，全量预备份不可行）：
//   ① modified/deleted 且缓存命中（peek 拿执行前 buffer）→ 备份执行前内容 → 可完整 undo
//   ② created → 记 operation='create' 条目（undo = 删除该文件）
//   ③ modified/deleted 未命中缓存 → 记无备份条目（undo 时提示不可恢复），事件照发

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FileCache } from './cache';
import type { Logger, ServiceRegistry } from '../../core/types';
import { ServiceNames } from '../../core/types';
import type { ShellChangeReport, ShellSnapshot, ShellWatchConfig } from './types';

/**
 * 快照遍历的固定剪枝集（拷自 tools/shared/search-core 的 ALWAYS_SKIP_DIRS + DEFAULT_IGNORES）。
 * 刻意不解析完整 .gitignore：快照场景 stat 清单本就近似（mtime 精度），固定剪枝覆盖
 * node_modules/dist/build 等大头即可；完整 gitignore 剪枝留在 grep/glob 的 walkFiles。
 * 同时使 filesys 内核服务不依赖 bun-only API（Bun.Glob），纯 node 工具链可用。
 */
const SNAPSHOT_SKIP_DIRS = new Set([
  '.git', '.hg', '.svn',
  'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.cache',
  '.turbo', '.output', '.vercel', 'coverage', '__pycache__', '.venv', 'venv',
  '.moss', '.trash',
]);

/** 轻量目录遍历：固定剪枝 + 超时检查，产出文件绝对路径（条目上限由调用方统计判断） */
function* walkSnapshotFiles(root: string, _maxFiles: number, deadline: number): Generator<string> {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // 无权限/竞态删除
    }
    for (const ent of entries) {
      if (Date.now() > deadline) return;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SNAPSHOT_SKIP_DIRS.has(ent.name)) continue;
        stack.push(full);
      } else if (ent.isFile()) {
        yield full;
      }
    }
  }
}

/**
 * file-history 侧的 shell 变更支持（最小结构类型，避免模块反向依赖 file-history 的类型）。
 * file-history 实现 trackShellFile 后自动生效；未实现（旧版本）时降级为仅检测+事件，不备份。
 */
export interface ShellHistorySupport {
  trackShellFile(
    sessionId: string,
    absPath: string,
    kind: 'created' | 'modified' | 'deleted',
    beforeBuffer: Buffer | null,
    toolCallId?: string,
  ): void;
}

export class ShellWatcher {
  constructor(
    private readonly deps: {
      cache: FileCache;
      logger: Logger;
      services: ServiceRegistry;
      getConfig: () => ShellWatchConfig;
    },
  ) {}

  /** shell 执行前快照：收集 roots 下全部文件的 stat 清单；禁用或文件数超限返回 null */
  async begin(cwd: string, extraRoots: readonly string[]): Promise<ShellSnapshot | null> {
    const cfg = this.deps.getConfig();
    if (!cfg.enabled) return null;

    const entries = new Map<string, { mtimeMs: number; size: number }>();
    const ok = this.collectInto([cwd, ...extraRoots], cfg.maxFiles, Number.POSITIVE_INFINITY, entries);
    if (!ok) {
      // 超限：跳过本次检测（大仓库保护），不产生半截快照
      this.deps.logger.warn('filesys: shell snapshot skipped, file count exceeds limit', {
        maxFiles: cfg.maxFiles,
      });
      return null;
    }
    return { roots: [cwd, ...extraRoots], entries };
  }

  /** shell 执行后 diff + 缓存回填备份。返回变更报告（快照无法 diff 时返回 null） */
  async end(snap: ShellSnapshot, sessionId: string, toolCallId: string): Promise<ShellChangeReport> {
    const cfg = this.deps.getConfig();
    const report: ShellChangeReport = {
      created: [],
      modified: [],
      deleted: [],
      undone: 0,
      skipped: false,
      truncated: false,
    };
    const deadline = Date.now() + cfg.timeoutMs;

    const after = new Map<string, { mtimeMs: number; size: number }>();
    const ok = this.collectInto(snap.roots, cfg.maxFiles, deadline, after);
    if (!ok) {
      // 截断保护（超时/超限）：放弃本次 diff。半截 after 与完整 before diff 会把
      // 大量未扫描文件误判为 deleted（多轮 shell 执行时被放大为成片误报），
      // 对齐 begin 的"不产生半截快照"哲学——宁可不跟踪，不可错跟踪。
      report.truncated = true;
      this.deps.logger.warn('filesys: shell snapshot truncated on end, diff skipped', {
        timeoutMs: cfg.timeoutMs,
        maxFiles: cfg.maxFiles,
        sessionId,
      });
      return report;
    }

    // diff 三分类
    for (const [path, meta] of after) {
      const before = snap.entries.get(path);
      if (!before) {
        report.created.push(path);
      } else if (before.mtimeMs !== meta.mtimeMs || before.size !== meta.size) {
        report.modified.push(path);
      }
    }
    for (const path of snap.entries.keys()) {
      if (!after.has(path)) report.deleted.push(path);
    }

    // 缓存回填备份（file-history 未实现 trackShellFile 时整体降级为仅报告）
    const history = this.resolveHistory();
    if (history) {
      for (const path of report.created) {
        try {
          history.trackShellFile(sessionId, path, 'created', null, toolCallId);
          report.undone++;
        } catch {
          /* 单文件失败不阻断 */
        }
      }
      for (const path of report.modified) {
        const buf = this.deps.cache.peek(path)?.rawBuffer ?? null;
        try {
          history.trackShellFile(sessionId, path, 'modified', buf, toolCallId);
          if (buf) report.undone++;
        } catch {
          /* 单文件失败不阻断 */
        }
      }
      for (const path of report.deleted) {
        const buf = this.deps.cache.peek(path)?.rawBuffer ?? null;
        try {
          history.trackShellFile(sessionId, path, 'deleted', buf, toolCallId);
          if (buf) report.undone++;
        } catch {
          /* 单文件失败不阻断 */
        }
      }
    }

    return report;
  }

  /**
   * walk + stat 收集清单。
   * @returns false = 超时/超限被截断（begin 视为放弃，end 按 truncated 处理）。
   * 超时判定必须在调用方循环内做：walkSnapshotFiles 超时直接 return（generator 正常
   * 结束），否则半截清单被当作完整结果返回（历史缺陷：截断被静默吞掉）。
   */
  private collectInto(
    roots: readonly string[],
    maxFiles: number,
    deadline: number,
    into: Map<string, { mtimeMs: number; size: number }>,
  ): boolean {
    for (const root of roots) {
      try {
        for (const abs of walkSnapshotFiles(root, maxFiles, deadline)) {
          if (into.size > maxFiles) return false;
          if (Date.now() > deadline) return false;
          try {
            const s = statSync(abs);
            into.set(abs, { mtimeMs: s.mtimeMs, size: s.size });
          } catch {
            /* walk 与 stat 之间被删除：忽略 */
          }
        }
      } catch (err) {
        this.deps.logger.debug('filesys: shell snapshot walk root failed', {
          root,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return true;
  }

  private resolveHistory(): ShellHistorySupport | null {
    try {
      const svc = this.deps.services.tryResolve<Partial<ShellHistorySupport>>(ServiceNames.FILE_HISTORY);
      if (svc && typeof svc.trackShellFile === 'function') {
        return svc as ShellHistorySupport;
      }
    } catch {
      /* 服务未注册 */
    }
    return null;
  }
}
