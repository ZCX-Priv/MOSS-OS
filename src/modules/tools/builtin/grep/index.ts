// builtin/grep/index.ts
// grep 工具 execute 逻辑：按正则表达式搜索文件内容，返回匹配的行。
// 复用 glob 工具的 globToRegex 和 IGNORED_DIRS。
// 元数据见同目录 tool.json。

import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { isBinaryFile, resolveWithinCwd } from '../../../../utils/fs';
import { stripBom } from '../../../../utils/encoding';
import { globToRegex, IGNORED_DIRS } from '../glob';
import type { ToolContext, ToolResult } from '../../types';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_LINE_DISPLAY = 500;
/** 正则长度上限，防止 LLM 注入超长模式 */
const MAX_PATTERN_LENGTH = 500;

/** 预检正则是否可能灾难性回溯（嵌套量词如 (a+)+ / (a*)* 等），是则拒绝 */
function isRiskyRegex(pattern: string): boolean {
  return /\([^()]*[+*{][^()]*\)[+*?{]/.test(pattern);
}

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
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
    if (p.pattern.length > MAX_PATTERN_LENGTH) {
      return {
        content: [{ type: 'text', text: `Error: pattern too long (max ${MAX_PATTERN_LENGTH} chars)` }],
        isError: true,
      };
    }
    if (isRiskyRegex(p.pattern)) {
      return {
        content: [{ type: 'text', text: 'Error: pattern rejected (potentially unsafe regex)' }],
        isError: true,
      };
    }

    let regex: RegExp;
    try {
      regex = new RegExp(p.pattern, p.caseInsensitive ? 'gi' : 'g');
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: invalid regex "${p.pattern}": ${err instanceof Error ? err.message : err}` }],
        isError: true,
      };
    }

    let searchPath: string;
    if (p.path) {
      const confined = resolveWithinCwd(p.path, ctx.cwd);
      if (!confined) {
        return {
          content: [{ type: 'text', text: `Error: path "${p.path}" escapes working directory` }],
          isError: true,
        };
      }
      searchPath = confined;
    } else {
      searchPath = ctx.cwd || process.cwd();
    }

    if (!exists(searchPath)) {
      return {
        content: [{ type: 'text', text: `Error: path not found: ${searchPath}` }],
        isError: true,
      };
    }

    let globRegex: RegExp | null = null;
    if (p.glob) {
      try {
        globRegex = globToRegex(p.glob);
      } catch {
        // glob 编译失败则忽略过滤
      }
    }

    const maxResults = Math.min(Math.max(p.maxResults ?? 100, 1), 500);

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
  let fileCount = 0;
  let stop = false;
  const walk = (dir: string, prefix: string, depth: number): void => {
    if (stop || depth > 24) return;
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
        if (fileCount >= 50_000) {
          stop = true;
          return;
        }
        fileCount++;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        results.push({ rel, abs: join(dir, entry.name) });
      }
    }
  };
  walk(root, '', 0);
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
