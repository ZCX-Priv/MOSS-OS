// builtin/read/index.ts
// read 工具 execute 逻辑：按行读取文件，带行号，二进制检测。
// 元数据（name/description/icon/annotations/inputSchema/config）见同目录 tool.json。

import { existsSync, statSync } from 'node:fs';
import { isAbsolute, normalize, resolve } from 'node:path';
import { isBinaryFile, readLinesWithNumbers } from '../../../../utils/fs';
import type { ToolContext, ToolResult } from '../../types';

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = params as { path: string; offset?: number; limit?: number };
    if (!p.path) {
      return { content: [{ type: 'text', text: 'Error: path is required' }], isError: true };
    }

    const absPath = resolveSafe(p.path, ctx.cwd);
    if (!absPath) {
      return {
        content: [{ type: 'text', text: `Error: path "${p.path}" escapes working directory` }],
        isError: true,
      };
    }

    if (!existsSync(absPath)) {
      return {
        content: [{ type: 'text', text: `Error: file not found: ${absPath}` }],
        isError: true,
      };
    }

    const stat = statSync(absPath);
    if (stat.isDirectory()) {
      return {
        content: [{ type: 'text', text: `Error: path is a directory, not a file: ${absPath}` }],
        isError: true,
      };
    }

    if (stat.size > 50 * 1024 * 1024) {
      return {
        content: [{ type: 'text', text: `Error: file too large (${stat.size} bytes, max 50MB): ${absPath}` }],
        isError: true,
      };
    }

    if (isBinaryFile(absPath)) {
      return {
        content: [{ type: 'text', text: `Error: binary file detected, cannot read as text: ${absPath}` }],
        isError: true,
      };
    }

    const offset = p.offset ?? 1;
    const limit = p.limit ?? 2000;

    try {
      const { text, totalLines, returnedLines } = readLinesWithNumbers(absPath, offset, limit);
      const header = `${absPath} (lines ${offset}-${offset + returnedLines - 1} of ${totalLines})\n`;
      return {
        content: [{ type: 'text', text: header + text }],
        metadata: {
          path: absPath,
          offset,
          limit,
          totalLines,
          returnedLines,
          sizeBytes: stat.size,
        },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error reading file: ${err instanceof Error ? err.message : err}` }],
        isError: true,
      };
    }
  },
};

/** 解析路径并防越权：返回 null 表示越权 */
function resolveSafe(path: string, cwd: string): string | null {
  const base = cwd || process.cwd();
  const abs = isAbsolute(path) ? normalize(path) : normalize(resolve(base, path));
  return abs;
}
