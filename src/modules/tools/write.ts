// src/plugins/tools/write.ts
// write 工具：覆盖写入文件，自动创建父目录。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, normalize } from 'node:path';
import type { Tool, ToolResult } from './types';

export const writeTool: Tool = {
  name: 'write',
  description:
    'Write content to a file, overwriting if it exists. ' +
    'Parent directories are created automatically if createDirs is true. ' +
    'This is a destructive operation.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file to write.',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file.',
      },
      createDirs: {
        type: 'boolean',
        description: 'Whether to create parent directories if they do not exist (default true).',
      },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  annotations: {
    destructiveHint: true,
    requireConfirmation: true,
  },
  icon: 'file-plus',
  async execute(params, ctx): Promise<ToolResult> {
    const p = params as { path: string; content: string; createDirs?: boolean };
    if (!p.path) {
      return { content: [{ type: 'text', text: 'Error: path is required' }], isError: true };
    }
    if (typeof p.content !== 'string') {
      return { content: [{ type: 'text', text: 'Error: content must be a string' }], isError: true };
    }

    const base = ctx.cwd || process.cwd();
    const absPath = isAbsolute(p.path) ? normalize(p.path) : normalize(resolve(base, p.path));
    const createDirs = p.createDirs ?? true;

    try {
      if (createDirs) {
        mkdirSync(dirname(absPath), { recursive: true });
      }
      writeFileSync(absPath, p.content, 'utf8');
      ctx.logger.info(`File written: ${absPath}`, { bytes: p.content.length });
      return {
        content: [{ type: 'text', text: `Successfully wrote ${p.content.length} bytes to ${absPath}` }],
        metadata: { path: absPath, bytes: p.content.length },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error writing file: ${err instanceof Error ? err.message : err}` }],
        isError: true,
      };
    }
  },
};

function resolve(...paths: string[]): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path');
  return path.resolve(...paths);
}
