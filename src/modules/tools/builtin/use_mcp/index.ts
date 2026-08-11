// builtin/use_mcp/index.ts
// use_mcp 工具 execute 逻辑：转发到指定 MCP 服务器的指定工具。
// 元数据见同目录 tool.json。

import type { ToolContext, ToolResult } from '../../types';
import type { MCPManager } from '../../../contracts';
import { ServiceNames } from '../../../../core/types';

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = params as { server: string; tool: string; arguments?: unknown };
    if (!p.server || !p.tool) {
      return {
        content: [{ type: 'text', text: 'Error: server and tool are required' }],
        isError: true,
      };
    }

    const mgr = ctx.services.tryResolve<MCPManager>(ServiceNames.MCP_MANAGER);
    if (!mgr) {
      return {
        content: [{ type: 'text', text: 'Error: MCP manager not available. Is the MCP plugin loaded?' }],
        isError: true,
      };
    }

    try {
      const result = await mgr.callTool(p.server, p.tool, p.arguments ?? {});
      // resource 类型无法映射为 image source 结构，统一转为 text 块
      const content = result.content.map(c => {
        if (c.type === 'text') {
          return { type: 'text' as const, text: c.text };
        }
        if (c.type === 'image') {
          return {
            type: 'image' as const,
            source: { data: c.data, mimeType: c.mimeType },
          };
        }
        // resource: 优先用 text 字段，否则生成占位符
        const resText = c.text ?? `[resource: ${c.uri} (${c.mimeType ?? 'unknown'})]`;
        return { type: 'text' as const, text: resText };
      });
      return {
        content,
        isError: result.isError,
        metadata: { server: p.server, tool: p.tool },
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Error calling MCP tool "${p.server}/${p.tool}": ${err instanceof Error ? err.message : err}`,
          },
        ],
        isError: true,
      };
    }
  },
};
