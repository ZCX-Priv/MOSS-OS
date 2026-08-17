// tools/glob/index.ts
// glob 工具 execute 逻辑：按 glob 模式匹配文件/目录，返回匹配路径列表。
// 引擎：Bun.Glob 原生匹配（支持 {a,b} 展开、! 否定、**、字符类）+ shared 异步 walker
// （gitignore 剪枝 / 隐藏文件开关 / 上限保护 / AbortSignal 取消）。
// 元数据见同目录 tool.json。

import { stat } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { Glob } from 'bun';
import { t } from '../../../core/i18n';
import { ServiceNames } from '../../../core/types';
import type { FilesysService } from '../../contracts';
import {
  walkFiles,
  typeToGlobs,
  toDisplayPath,
  SUPPORTED_TYPES,
  type WalkEntry,
} from '../shared/search-core';
import type { ToolContext, ToolResult } from '../types';

interface GlobParams {
  pattern?: string | string[];
  path?: string;
  type?: string;
  maxResults?: number;
  offset?: number;
  includeDirs?: boolean;
  noIgnore?: boolean;
  dot?: boolean;
  sortBy?: 'mtime' | 'path';
}

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = (params ?? {}) as GlobParams;
    const startedAt = Date.now();

    // ---- 参数校验：pattern ----
    const rawPatterns = Array.isArray(p.pattern)
      ? p.pattern
      : p.pattern !== undefined
        ? [p.pattern]
        : [];
    const patterns = rawPatterns.filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (patterns.length === 0) {
      return { content: [{ type: 'text', text: 'Error: pattern is required' }], isError: true };
    }

    // ---- 模式归一化与正/负分组（! 前缀为排除过滤）----
    const normalized = patterns.map(pat => pat.split('\\').join('/'));
    const positivePats = normalized.filter(pat => !pat.startsWith('!'));
    const negativePats = normalized.filter(pat => pat.startsWith('!')).map(pat => pat.slice(1));
    // 全为负模式时：匹配所有文件再排除（如 pattern: "!**/*.test.ts"）
    if (positivePats.length === 0) positivePats.push('**');

    let positiveGlobs: Glob[];
    let negativeGlobs: Glob[];
    try {
      positiveGlobs = positivePats.map(pat => new Glob(pat));
      negativeGlobs = negativePats.map(pat => new Glob(pat));
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${t('tools.searchInvalidGlob', { pattern: Array.isArray(p.pattern) ? p.pattern.join(', ') : (p.pattern ?? ''), reason: err instanceof Error ? err.message : String(err) })}`,
        }],
        isError: true,
      };
    }

    // ---- type 过滤 ----
    let typeGlobs: Glob[] | null = null;
    if (p.type) {
      const globs = typeToGlobs(p.type);
      if (!globs) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${t('tools.searchInvalidType', { type: p.type, types: SUPPORTED_TYPES_INLINE })}`,
          }],
          isError: true,
        };
      }
      typeGlobs = globs.map(g => new Glob(g));
    }

    // ---- 路径解析与隔离（filesys roots 机制）----
    const filesys = ctx.services.tryResolve<FilesysService>(ServiceNames.FILESYS);
    if (!filesys) {
      return {
        content: [{ type: 'text', text: `Error: ${t('filesys.serviceUnavailable')}` }],
        isError: true,
      };
    }
    let base: string;
    if (p.path) {
      const confined = filesys.resolve(p.path, ctx.cwd);
      if (!confined) {
        return {
          content: [{ type: 'text', text: `Error: ${t('fs.pathOutsideRoots', { path: p.path, roots: '' })}` }],
          isError: true,
        };
      }
      base = confined;
    } else {
      base = ctx.cwd || process.cwd();
    }

    try {
      if (!statSync(base).isDirectory()) {
        return {
          content: [{ type: 'text', text: `Error: path is not a directory: ${base}` }],
          isError: true,
        };
      }
    } catch {
      return {
        content: [{ type: 'text', text: `Error: path not found: ${base}` }],
        isError: true,
      };
    }

    // ---- 配置（config.tools.glob 覆盖默认行为）----
    const cfg = (ctx.toolConfig ?? {}) as { respectGitignore?: boolean; maxResults?: number };
    const noIgnore = p.noIgnore === true || cfg.respectGitignore === false;
    const maxResults = Math.min(Math.max(p.maxResults ?? cfg.maxResults ?? 200, 1), 1000);
    const offset = Math.max(p.offset ?? 0, 0);
    const sortBy: 'mtime' | 'path' = p.sortBy === 'path' ? 'path' : 'mtime';

    // ---- 遍历 + 匹配（流式；目录豁免 type 检查）----
    const matched: WalkEntry[] = [];
    let filesWalked = 0;
    let cancelled = false;

    const matchesEntry = (entry: WalkEntry): boolean => {
      const hitPositive = positiveGlobs.some(g => g.match(entry.rel));
      if (!hitPositive) return false;
      if (negativeGlobs.length > 0 && negativeGlobs.some(g => g.match(entry.rel))) return false;
      if (typeGlobs && !entry.isDir && !typeGlobs.some(g => g.match(entry.rel))) return false;
      return true;
    };

    try {
      for await (const entry of walkFiles(base, {
        signal: ctx.signal,
        noIgnore,
        dot: p.dot === true,
        includeDirs: p.includeDirs === true,
      })) {
        filesWalked++;
        if (matchesEntry(entry)) matched.push(entry);
        // 遍历上限保护：匹配数显著超出分页窗口时提前终止
        if (matched.length > offset + maxResults + 1000) break;
      }
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
    if (ctx.signal?.aborted) cancelled = true;

    // ---- 去重 + 排序 + 分页 ----
    const seen = new Set<string>();
    const unique = matched.filter(e => (seen.has(e.rel) ? false : (seen.add(e.rel), true)));

    if (sortBy === 'mtime') {
      const mtimeCache = new Map<string, number>();
      await Promise.all(
        unique.map(async e => {
          try {
            const s = await stat(e.abs);
            mtimeCache.set(e.rel, s.mtimeMs);
          } catch {
            mtimeCache.set(e.rel, 0);
          }
        }),
      );
      unique.sort((a, b) => (mtimeCache.get(b.rel) ?? 0) - (mtimeCache.get(a.rel) ?? 0));
    } else {
      unique.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
    }

    const total = unique.length;
    const truncated = total > offset + maxResults;
    const page = unique.slice(offset, offset + maxResults);
    const displayBase = ctx.cwd || process.cwd();
    const lines = page.map(e => toDisplayPath(e.abs, displayBase));

    // ---- 输出 ----
    const patternDesc = Array.isArray(p.pattern) ? p.pattern.join('", "') : p.pattern;
    const header =
      `Found ${total} entr${total === 1 ? 'y' : 'ies'} matching "${patternDesc}"` +
      `${p.type ? ` (type: ${p.type})` : ''} in ${toDisplayPath(base, displayBase)}` +
      `${truncated ? ` (showing ${offset + 1}-${offset + page.length})` : ''}\n`;
    const hint = truncated ? `\n${t('tools.searchTruncatedHint')}` : '';
    const cancelledNote = cancelled ? `\n${t('tools.searchCancelled')}` : '';
    const body = lines.length > 0 ? lines.join('\n') : t('tools.searchNoResults');

    return {
      content: [{ type: 'text', text: header + body + hint + cancelledNote }],
      metadata: {
        patterns: normalized,
        root: base,
        type: p.type ?? null,
        totalMatches: total,
        returned: page.length,
        truncated,
        maxResults,
        offset,
        sortBy,
        includeDirs: p.includeDirs ?? false,
        noIgnore,
        dot: p.dot ?? false,
        filesWalked,
        cancelled,
        elapsedMs: Date.now() - startedAt,
      },
    };
  },
};

/** 类型清单（逗号连接，错误提示用） */
const SUPPORTED_TYPES_INLINE = SUPPORTED_TYPES.join(', ');
