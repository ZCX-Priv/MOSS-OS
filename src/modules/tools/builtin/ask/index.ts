// builtin/ask/index.ts
// ask 工具 execute 逻辑：向用户提问并阻塞等待回复。
// 元数据见同目录 tool.json。

import type { ToolContext, ToolResult } from '../../types';

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = params as { question: string };

    if (!p.question || typeof p.question !== 'string' || p.question.trim() === '') {
      return { content: [{ type: 'text', text: 'Error: question is required' }], isError: true };
    }

    if (!ctx.askUser) {
      return {
        content: [{ type: 'text', text: 'Error: ask not supported in this context (no interactive channel)' }],
        isError: true,
      };
    }

    try {
      const answer = await ctx.askUser(p.question);
      return {
        content: [{ type: 'text', text: answer }],
        metadata: { question: p.question },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error: ask failed: ${msg}` }],
        isError: true,
      };
    }
  },
};
