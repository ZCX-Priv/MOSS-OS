// builtin/write/index.ts
// write 工具 execute 逻辑：覆盖写入文件，自动创建父目录。
// 元数据见同目录 tool.json。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, normalize, resolve } from 'node:path';
import type { ToolContext, ToolResult } from '../../types';

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
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
