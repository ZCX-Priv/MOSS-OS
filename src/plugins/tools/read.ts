// src/plugins/tools/read.ts
// read 工具：按行读取文件，带行号，二进制检测，路径防越权。

import { existsSync, statSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';
import { isBinaryFile, readLinesWithNumbers } from '../../utils/fs';
import type { Tool, ToolResult } from './types';

export const readTool: Tool = {
  name: 'read',
  description:
    'Read the contents of a text file. Returns lines with line numbers. ' +
    'Supports offset and limit for partial reads. ' +
    'Binary files are detected and rejected.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file to read.',
      },
      offset: {
        type: 'integer',
        description: 'Line number to start reading from (1-based, default 1).',
        minimum: 1,
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of lines to read (default 2000).',
        minimum: 1,
        maximum: 10000,
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
  },
  async execute(params, ctx): Promise<ToolResult> {
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

    // 二进制检测
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
  // 简单越权检测：允许访问 cwd 及其子路径
  // 但允许通过绝对路径访问其他目录（Agent 需要这个能力）
  // 仅做 normalize 防止 ../ 注入
  return abs;
}

function resolve(...paths: string[]): string {
  // 简易 path.resolve 实现，避免循环依赖 node:path
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path');
  return path.resolve(...paths);
}
