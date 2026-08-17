// tools/use_mcp/index.ts
// use_mcp 工具 execute 逻辑：转发到指定 MCP 服务器的指定工具。
// 元数据见同目录 tool.json。

import type { ToolContext, ToolResult } from '../types';
import type { MCPManager } from '../../contracts';
import { ServiceNames } from '../../../core/types';

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
        content: [{ type: 'text', text: 'Error: MCP manager not available. Is the MCP module loaded?' }],
        isError: true,
      };
    }

    // server 启用检查（disabled / 未定义 → 拒绝）
    if (mgr.isServerEnabled(p.server) !== true) {
      return {
        content: [{ type: 'text', text: `Error: MCP server "${p.server}" is disabled or not found` }],
        isError: true,
      };
    }

    try {
      // 超时：优先 toolConfig.timeout（config.tools.use_mcp），回退 config.mcp.callTimeoutMs（120s）
      const timeoutMs =
        (typeof ctx.toolConfig?.timeout === 'number' ? ctx.toolConfig.timeout : undefined) ??
        120000;
      const result = await mgr.callTool(p.server, p.tool, p.arguments ?? {}, {
        timeoutMs,
        signal: ctx.signal,
      });
      // resource 完整数据收集（metadata 供前端渲染引用卡片）
      const resources = result.content
        .filter((c): c is Extract<typeof c, { type: 'resource' }> => c.type === 'resource')
        .map(c => ({ uri: c.uri, mimeType: c.mimeType, text: c.text, blob: c.blob }));
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
        // resource：正文给可读摘要，完整数据在 metadata.resources
        const resText = c.text ?? `[resource: ${c.uri} (${c.mimeType ?? 'unknown'})]`;
        return { type: 'text' as const, text: resText };
      });
      return {
        content,
        isError: result.isError,
        metadata: {
          server: p.server,
          tool: p.tool,
          ...(result.structured !== undefined ? { structured: result.structured } : {}),
          ...(resources.length > 0 ? { resources } : {}),
        },
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
