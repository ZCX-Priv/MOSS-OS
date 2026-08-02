// src/modules/tools/ask.ts
// ask 工具：向用户提问并阻塞等待回复。通过 ToolContext.askUser 建立双向通道。

import type { Tool, ToolResult } from './types';

export const askTool: Tool = {
  name: 'ask',
  description:
    'Ask the user a question and wait for their text reply. ' +
    'Use this when you need clarification, a decision, or information only the user can provide. ' +
    'Returns the user\'s reply text. The call blocks until the user responds or times out (5 minutes).',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question to ask the user. Be specific and concise.',
      },
    },
    required: ['question'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
  },
  async execute(params, ctx): Promise<ToolResult> {
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
