// builtin/glob/index.ts
// glob 工具 execute 逻辑：按文件名模式匹配文件，返回匹配的文件路径列表。
// 注意：globToRegex 和 IGNORED_DIRS 作为 named export，供 grep 工具复用。
// 元数据见同目录 tool.json。

import { readdirSync, statSync, type Dirent } from 'node:fs';
import { join, sep } from 'node:path';
import { resolveWithinCwd } from '../../../../utils/fs';
import type { ToolContext, ToolResult } from '../../types';

/** 递归遍历时跳过的目录名 */
export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache']);
/** 遍历深度与文件数上限，防止超大目录阻塞事件循环 */
const MAX_DEPTH = 24;
const MAX_FILES = 50_000;

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = params as { pattern: string; path?: string; maxResults?: number };

    if (!p.pattern || typeof p.pattern !== 'string') {
      return { content: [{ type: 'text', text: 'Error: pattern is required' }], isError: true };
    }

    let base: string | null;
    if (p.path) {
      base = resolveWithinCwd(p.path, ctx.cwd);
      if (!base) {
        return {
          content: [{ type: 'text', text: `Error: path "${p.path}" escapes working directory` }],
          isError: true,
        };
      }
    } else {
      base = ctx.cwd || process.cwd();
    }

    let stat;
    try {
      stat = statSync(base);
    } catch {
      return {
        content: [{ type: 'text', text: `Error: path not found: ${base}` }],
        isError: true,
      };
    }
    if (!stat.isDirectory()) {
      return {
        content: [{ type: 'text', text: `Error: path is not a directory: ${base}` }],
        isError: true,
      };
    }

    const maxResults = Math.min(Math.max(p.maxResults ?? 200, 1), 1000);

    const files = collectFiles(base);

    let regex: RegExp;
    try {
      regex = globToRegex(p.pattern);
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: invalid glob pattern "${p.pattern}": ${err instanceof Error ? err.message : err}` }],
        isError: true,
      };
    }

    const matched: string[] = [];
    for (const rel of files) {
      if (regex.test(rel)) {
        matched.push(join(base, rel.split('/').join(sep)));
      }
    }
    matched.sort();

    const total = matched.length;
    const truncated = total > maxResults;
    const result = truncated ? matched.slice(0, maxResults) : matched;

    const header = `Found ${total} file${total === 1 ? '' : 's'} matching "${p.pattern}" in ${base}${truncated ? ` (showing first ${maxResults})` : ''}\n`;
    const body = result.length > 0 ? result.join('\n') : '(no matches)';

    return {
      content: [{ type: 'text', text: header + body }],
      metadata: {
        pattern: p.pattern,
        root: base,
        totalMatches: total,
        returned: result.length,
        truncated,
        maxResults,
      },
    };
  },
};

/**
 * 递归收集 root 下所有文件的相对路径（用 / 分隔），跳过 IGNORED_DIRS。
 */
function collectFiles(root: string): string[] {
  const results: string[] = [];
  let fileCount = 0;
  let stop = false;
  const walk = (dir: string, prefix: string, depth: number): void => {
    if (stop || depth > MAX_DEPTH) return;
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (stop) return;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name, depth + 1);
      } else if (entry.isFile()) {
        if (fileCount >= MAX_FILES) {
          stop = true;
          return;
        }
        fileCount++;
        results.push(prefix ? `${prefix}/${entry.name}` : entry.name);
      }
    }
  };
  walk(root, '', 0);
  return results;
}

/**
 * 将 glob pattern 转为正则表达式（锚定首尾）。
 * 支持：** (跨目录)、* (非分隔符)、? (单个非分隔符)、[abc] / [a-z] (字符类)。
 */
export function globToRegex(pattern: string): RegExp {
  let regex = '^';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];

    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i += 2;
        if (pattern[i] === '/') {
          i++;
          regex += '(?:.*/)?';
        } else {
          regex += '.*';
        }
      } else {
        regex += '[^/]*';
        i++;
      }
      continue;
    }

    if (c === '?') {
      regex += '[^/]';
      i++;
      continue;
    }

    if (c === '[') {
      let cls = '';
      i++;
      if (pattern[i] === '!') {
        cls += '^';
        i++;
      }
      while (i < pattern.length && pattern[i] !== ']') {
        const ch = pattern[i];
        if (ch === '\\') {
          cls += '\\\\';
          i++;
          if (pattern[i] !== undefined) {
            cls += escapeRegexChar(pattern[i]);
            i++;
          }
        } else {
          cls += ch;
          i++;
        }
      }
      if (pattern[i] === ']') {
        regex += `[${cls}]`;
        i++;
      } else {
        regex += '\\[';
      }
      continue;
    }

    if (c === '/') {
      regex += '/';
    } else {
      regex += escapeRegexChar(c);
    }
    i++;
  }
  regex += '$';
  return new RegExp(regex);
}

/** 转义正则元字符 */
function escapeRegexChar(c: string): string {
  if ('\\.+^$(){}|'.includes(c)) {
    return '\\' + c;
  }
  return c;
}
