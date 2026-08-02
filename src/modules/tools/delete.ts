// src/modules/tools/delete.ts
// delete 工具：删除文件或目录（递归）。破坏性操作，需确认。

import { existsSync, statSync, unlinkSync, rmSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';
import type { Tool, ToolResult } from './types';

export const deleteTool: Tool = {
  name: 'delete',
  description:
    'Delete a file or directory. ' +
    'For a directory, recursive must be true (recursive deletion). ' +
    'This is a destructive operation and cannot be undone.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file or directory to delete.',
      },
      recursive: {
        type: 'boolean',
        description: 'Required when deleting a directory. If true, recursively delete the directory tree. Ignored for files.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  annotations: {
    destructiveHint: true,
    requireConfirmation: true,
  },
  async execute(params, ctx): Promise<ToolResult> {
    const p = params as { path: string; recursive?: boolean };

    if (!p.path) {
      return { content: [{ type: 'text', text: 'Error: path is required' }], isError: true };
    }

    const base = ctx.cwd || process.cwd();
    const absPath = isAbsolute(p.path) ? normalize(p.path) : normalize(resolve(base, p.path));

    if (!existsSync(absPath)) {
      return {
        content: [{ type: 'text', text: `Error: path not found: ${absPath}` }],
        isError: true,
      };
    }

    const stat = statSync(absPath);

    try {
      if (stat.isDirectory()) {
        if (!p.recursive) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: "${absPath}" is a directory. Set recursive=true to delete it recursively.`,
              },
            ],
            isError: true,
          };
        }
        rmSync(absPath, { recursive: true, force: false });
        ctx.logger.info(`Directory deleted: ${absPath}`);
        return {
          content: [{ type: 'text', text: `Successfully deleted directory: ${absPath}` }],
          metadata: { path: absPath, type: 'directory', recursive: true },
        };
      }

      unlinkSync(absPath);
      ctx.logger.info(`File deleted: ${absPath}`);
      return {
        content: [{ type: 'text', text: `Successfully deleted file: ${absPath}` }],
        metadata: { path: absPath, type: 'file' },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error deleting path: ${err instanceof Error ? err.message : err}` }],
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
