// src/modules/filesys/roots.ts
// roots 机制：cwd（隐含 root）+ 配置的额外授权目录，统一越权拒绝。
// 参考 MCP filesystem server 的 Roots 设计：允许的根目录列表，动态可配，越界统一拒绝。
// extraRoots 为空时行为与旧版 resolveWithinCwd 完全一致（零迁移风险）。

import { isAbsolute, normalize, resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { isPathInside } from '../../utils/fs';

/**
 * roots 解析：相对路径基于 cwd 解析；绝对路径直接使用；
 * 标准化后必须位于 cwd 或任一额外授权 root 内（含自身），否则返回 null（调用方拒绝访问）。
 */
export function resolveInRoots(rawPath: string, cwd: string, extraRoots: readonly string[]): string | null {
  const base = cwd || process.cwd();
  const abs = isAbsolute(rawPath) ? normalize(rawPath) : normalize(resolve(base, rawPath));
  if (isPathInside(abs, base)) return abs;
  for (const root of extraRoots) {
    if (isPathInside(abs, root)) return abs;
  }
  return null;
}

/**
 * 归一化授权 roots：仅保留真实存在的目录绝对路径（去重）。
 * 不存在的目录静默丢弃（配置指向已卸载的盘符等场景），保证服务可用。
 */
export function normalizeRoots(roots: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of roots) {
    if (!raw || !isAbsolute(raw)) continue;
    const p = normalize(raw);
    const key = process.platform === 'win32' ? p.toLowerCase() : p;
    if (seen.has(key)) continue;
    try {
      if (!existsSync(p) || !statSync(p).isDirectory()) continue;
    } catch {
      continue;
    }
    seen.add(key);
    out.push(p);
  }
  return out;
}
