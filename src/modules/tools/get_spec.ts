// src/modules/tools/get_spec.ts
// get_spec 工具：按 id 读取指定 spec 规范文件的完整 Markdown 内容。
// spec id 为相对 agent/prompts/main/spec/ 的路径去 .md 后缀（如 "coding/typescript"）。

import type { Tool, ToolResult } from './types';
import { ServiceNames } from '../../core/types';
import type { SpecRegistry } from './specs';

export const getSpecTool: Tool = {
  name: 'get_spec',
  description:
    'Read the full content of a specification document by its id. ' +
    'The spec id is the relative path under agent/prompts/main/spec/ without the .md ' +
    'extension (e.g. "coding/typescript", "safety"). ' +
    'Use list_spec first to discover available spec ids. ' +
    'Returns the Markdown body of the spec (front-matter stripped).',
  inputSchema: {
    type: 'object',
    properties: {
      spec: {
        type: 'string',
        description:
          'Spec id to read (relative path without .md, e.g. "coding/typescript").',
      },
    },
    required: ['spec'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
  },
  icon: 'file-code',
  async execute(params, ctx): Promise<ToolResult> {
    const p = params as { spec: string };
    if (!p.spec) {
      return { content: [{ type: 'text', text: 'Error: spec is required' }], isError: true };
    }

    const reg = ctx.services.tryResolve<SpecRegistry>(ServiceNames.SPEC_REGISTRY);
    if (!reg) {
      return {
        content: [{ type: 'text', text: 'Error: spec registry not available' }],
        isError: true,
      };
    }

    const spec = reg.get(p.spec);
    if (!spec) {
      const available = reg.list().map(s => s.id).join(', ');
      return {
        content: [
          {
            type: 'text',
            text: `Error: spec "${p.spec}" not found. Available: ${available || '(none)'}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [{ type: 'text', text: spec.content }],
      metadata: { spec: p.spec, description: spec.description || undefined },
    };
  },
};
