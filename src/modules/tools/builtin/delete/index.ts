// builtin/delete/index.ts
// delete 工具 execute 逻辑：删除文件或目录（递归）。破坏性操作。
// 元数据见同目录 tool.json。

import { existsSync, statSync, unlinkSync, rmSync } from 'node:fs';
import { isAbsolute, normalize, resolve } from 'node:path';
import type { ToolContext, ToolResult } from '../../types';

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
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
