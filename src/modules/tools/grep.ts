// src/modules/tools/grep.ts
// grep 工具：按正则表达式搜索文件内容，返回匹配的行（带文件路径和行号）。
// 支持限定目录、文件名 glob 过滤、大小写不敏感。跳过二进制文件和忽略目录。

import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { isAbsolute, normalize, join } from 'node:path';
import { isBinaryFile } from '../../utils/fs';
import { stripBom } from '../../utils/encoding';
import { globToRegex, IGNORED_DIRS } from './glob';
import type { Tool, ToolResult } from './types';

/** 单个文件大小上限 10MB，超出跳过 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
/** 单行最大显示长度，超出截断 */
const MAX_LINE_DISPLAY = 500;

export const grepTool: Tool = {
  name: 'grep',
  description:
    'Search file contents by regular expression. Returns matching lines with file path and line number. ' +
    'Supports searching a file or directory, optional glob filename filter, and case-insensitive mode. ' +
    'Binary files and node_modules/.git/dist/build are skipped.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regular expression pattern to search for (e.g. "function\\s+\\w+", "TODO|FIXME").',
      },
      path: {
        type: 'string',
        description: 'File or directory to search in (default: agent working directory). Absolute or relative to cwd.',
      },
      glob: {
        type: 'string',
        description: 'Optional glob filter for filenames, e.g. "*.ts", "**/*.json". Only matching files are searched.',
      },
      caseInsensitive: {
        type: 'boolean',
        description: 'Case-insensitive matching (default false).',
      },
      maxResults: {
        type: 'integer',
        description: 'Maximum number of matching lines to return (default 100, max 500).',
        minimum: 1,
        maximum: 500,
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
  },
  icon: 'search',
  async execute(params, ctx): Promise<ToolResult> {
    const p = params as {
      pattern: string;
      path?: string;
      glob?: string;
      caseInsensitive?: boolean;
      maxResults?: number;
    };

    if (!p.pattern || typeof p.pattern !== 'string') {
      return { content: [{ type: 'text', text: 'Error: pattern is required' }], isError: true };
    }

    // 编译正则
    let regex: RegExp;
    try {
      regex = new RegExp(p.pattern, p.caseInsensitive ? 'gi' : 'g');
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: invalid regex "${p.pattern}": ${err instanceof Error ? err.message : err}` }],
        isError: true,
      };
    }

    const searchPath = p.path
      ? (isAbsolute(p.path) ? normalize(p.path) : normalize(join(ctx.cwd || process.cwd(), p.path)))
      : (ctx.cwd || process.cwd());

    if (!exists(searchPath)) {
      return {
        content: [{ type: 'text', text: `Error: path not found: ${searchPath}` }],
        isError: true,
      };
    }

    // 编译文件名 glob 过滤
    let globRegex: RegExp | null = null;
    if (p.glob) {
      try {
        globRegex = globToRegex(p.glob);
      } catch {
        // glob 编译失败则忽略过滤
      }
    }

    const maxResults = Math.min(Math.max(p.maxResults ?? 100, 1), 500);

    // 收集待搜索文件
    let filesToSearch: string[];
    const pathStat = statSync(searchPath);
    if (pathStat.isFile()) {
      filesToSearch = [searchPath];
    } else if (pathStat.isDirectory()) {
      filesToSearch = collectFiles(searchPath)
        .filter(f => (globRegex ? globRegex.test(f.rel) : true))
        .map(f => f.abs);
    } else {
      return {
        content: [{ type: 'text', text: `Error: path is neither file nor directory: ${searchPath}` }],
        isError: true,
      };
    }

    // 逐文件搜索
    const matches: string[] = [];
    let filesScanned = 0;
    let filesWithMatches = 0;
    let truncated = false;

    for (const file of filesToSearch) {
      if (truncated) break;
      filesScanned++;

      let stat;
      try {
        stat = statSync(file);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_SIZE) continue;
      if (isBinaryFile(file)) continue;

      let content: string;
      try {
        content = stripBom(readFileSync(file, 'utf8'));
      } catch {
        continue;
      }

      const lines = content.split('\n');
      let fileHadMatch = false;
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          if (!fileHadMatch) {
            fileHadMatch = true;
            filesWithMatches++;
          }
          const lineNum = i + 1;
          const lineText = truncateLine(lines[i]);
          matches.push(`${file}:${lineNum}:${lineText}`);
          if (matches.length >= maxResults) {
            truncated = true;
            break;
          }
        }
      }
    }

    const header = `Found ${matches.length} match${matches.length === 1 ? '' : 'es'} in ${filesWithMatches} file${filesWithMatches === 1 ? '' : 's'} (scanned ${filesScanned})${truncated ? ` (showing first ${maxResults})` : ''}\n`;
    const body = matches.length > 0 ? matches.join('\n') : '(no matches)';

    return {
      content: [{ type: 'text', text: header + body }],
      metadata: {
        pattern: p.pattern,
        caseInsensitive: p.caseInsensitive ?? false,
        glob: p.glob ?? null,
        root: searchPath,
        filesScanned,
        filesWithMatches,
        totalMatches: matches.length,
        truncated,
        maxResults,
      },
    };
  },
};

/** 递归收集文件，返回相对路径（/ 分隔）与绝对路径 */
function collectFiles(root: string): Array<{ rel: string; abs: string }> {
  const results: Array<{ rel: string; abs: string }> = [];
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
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        results.push({ rel, abs: join(dir, entry.name) });
      }
    }
  };
  walk(root, '');
  return results;
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function truncateLine(line: string): string {
  if (line.length <= MAX_LINE_DISPLAY) return line;
  return line.slice(0, MAX_LINE_DISPLAY) + '...(truncated)';
}
