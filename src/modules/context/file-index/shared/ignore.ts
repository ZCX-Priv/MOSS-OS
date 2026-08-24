// src/modules/context/file-index/shared/ignore.ts
// 索引忽略规则：默认目录黑名单 + config.context.fileIndex.ignore 自定义 glob。
// .gitignore 由 walkFiles（复用 search-core）在遍历时处理，此处只做额外的静态过滤。

import { Glob } from 'bun';

/** 默认忽略目录名（索引不需要的产物/依赖/缓存目录） */
export const DEFAULT_INDEX_IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
  '.cache', 'coverage', '__pycache__', '.venv', 'venv', 'env',
  'target', '.moss', '.trash', '.turbo', '.nyc_output', '.idea', '.svelte-kit',
]);

/** 编译自定义忽略 glob（config.context.fileIndex.ignore） */
export class IgnoreGlobs {
  private readonly globs: readonly Glob[];

  private constructor(globs: Glob[]) {
    this.globs = globs;
  }

  static compile(patterns: readonly string[]): IgnoreGlobs | null {
    const globs: Glob[] = [];
    for (const p of patterns) {
      if (typeof p !== 'string' || p === '') continue;
      try {
        globs.push(new Glob(p));
      } catch {
        // 无效 glob 静默丢弃
      }
    }
    return globs.length > 0 ? new IgnoreGlobs(globs) : null;
  }

  /** 命中任一模式 → 忽略 */
  matches(relPath: string): boolean {
    return this.globs.some(g => g.match(relPath));
  }
}

/** 目录名是否在默认黑名单内（watcher 事件过滤用，避免 node_modules 噪音入库） */
export function isDefaultIgnoredDir(name: string): boolean {
  return DEFAULT_INDEX_IGNORE_DIRS.has(name);
}

/**
 * 判定相对路径是否应被索引忽略（watcher 事件过滤用）。
 * 检查路径中任意一段命中默认目录黑名单，或整体命中自定义 glob。
 */
export function shouldIgnorePath(relPath: string, custom: IgnoreGlobs | null): boolean {
  const segments = relPath.split('/');
  // 最后一段为文件名，其余为目录段；目录段命中黑名单即忽略
  for (let i = 0; i < segments.length - 1; i++) {
    if (isDefaultIgnoredDir(segments[i])) return true;
  }
  // 隐藏文件/目录（. 开头）不索引（与 walkFiles dot=false 语义一致）
  for (const seg of segments) {
    if (seg.startsWith('.')) return true;
  }
  if (custom?.matches(relPath)) return true;
  return false;
}
