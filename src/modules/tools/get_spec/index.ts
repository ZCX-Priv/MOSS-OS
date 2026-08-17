// tools/get_spec/index.ts
// get_spec 工具 execute 逻辑：按 id 读取指定 spec 规范文件的完整 Markdown 内容。
// 元数据见同目录 tool.json。

import type { ToolContext, ToolResult } from '../types';
import { ServiceNames } from '../../../core/types';
import type { SpecRegistry } from './registry';

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
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
