// src/modules/tools/glob.ts
// glob 工具：按文件名模式（glob pattern）匹配文件，返回匹配的文件路径列表。
// 支持 * / ** / ? / [abc] 通配符。递归遍历时跳过常见忽略目录。

import { readdirSync, statSync, type Dirent } from 'node:fs';
import { isAbsolute, normalize, join, sep } from 'node:path';
import type { Tool, ToolResult } from './types';

/** 递归遍历时跳过的目录名 */
export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache']);

export const globTool: Tool = {
  name: 'glob',
  description:
    'Find files by glob pattern. Supports * (non-separator), ** (any depth), ? (single char), [abc] (char class). ' +
    'Returns a sorted list of matching file paths. Skips node_modules/.git/dist/build by default.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern, e.g. "**/*.ts", "src/**/*.json", "*.md". Use "/" as path separator.',
      },
      path: {
        type: 'string',
        description: 'Root directory to search in (default: agent working directory). Absolute or relative to cwd.',
      },
      maxResults: {
        type: 'integer',
        description: 'Maximum number of results to return (default 200, max 1000).',
        minimum: 1,
        maximum: 1000,
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
  },
  async execute(params, ctx): Promise<ToolResult> {
    const p = params as { pattern: string; path?: string; maxResults?: number };

    if (!p.pattern || typeof p.pattern !== 'string') {
      return { content: [{ type: 'text', text: 'Error: pattern is required' }], isError: true };
    }

    const base = p.path
      ? (isAbsolute(p.path) ? normalize(p.path) : normalize(join(ctx.cwd || process.cwd(), p.path)))
      : (ctx.cwd || process.cwd());

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

    // 收集所有文件相对路径（用 / 分隔，便于跨平台匹配）
    const files = collectFiles(base);

    // 编译 glob 为正则
    let regex: RegExp;
    try {
      regex = globToRegex(p.pattern);
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: invalid glob pattern "${p.pattern}": ${err instanceof Error ? err.message : err}` }],
        isError: true,
      };
    }

    // 匹配
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
  const walk = (dir: string, prefix: string): void => {
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.isFile()) {
        results.push(prefix ? `${prefix}/${entry.name}` : entry.name);
      }
    }
  };
  walk(root, '');
  return results;
}

/**
 * 将 glob pattern 转为正则表达式（锚定首尾）。
 * 支持：** (跨目录)、* (非分隔符)、? (单个非分隔符)、[abc] / [a-z] (字符类)。
 * 路径分隔符统一为 /。
 */
export function globToRegex(pattern: string): RegExp {
  let regex = '^';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];

    if (c === '*') {
      // 处理 ** 和 **/
      if (pattern[i + 1] === '*') {
        i += 2;
        // ** 后跟 / → 匹配任意层级目录（含 0 层）
        if (pattern[i] === '/') {
          i++;
          regex += '(?:.*/)?';
        } else {
          // ** 在末尾或后接其他 → 匹配任意字符（含 /）
          regex += '.*';
        }
      } else {
        // 单 * → 匹配非分隔符
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
      // 字符类：找到闭合 ]
      let cls = '';
      i++;
      if (pattern[i] === '!') {
        cls += '^';
        i++;
      }
      while (i < pattern.length && pattern[i] !== ']') {
        const ch = pattern[i];
        // 转义正则特殊字符（在字符类内大部分无需转义，但 ] ^ - 需注意位置）
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
        // 未闭合，按字面量处理
        regex += '\\[';
      }
      continue;
    }

    // 其他字符：转义正则特殊字符，/ 保留
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
