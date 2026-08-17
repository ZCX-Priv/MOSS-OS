// tools/list_mcp/index.ts
// list_mcp 工具 execute 逻辑：列出所有 MCP 服务器（含启用状态）及工具清单。
// 元数据见同目录 tool.json。

import type { ToolContext, ToolResult } from '../types';
import type { MCPManager } from '../../contracts';
import { ServiceNames } from '../../../core/types';

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = params as { server?: string };

    const mgr = ctx.services.tryResolve<MCPManager>(ServiceNames.MCP_MANAGER);
    if (!mgr) {
      return {
        content: [{ type: 'text', text: 'Error: MCP manager not available. Is the MCP module loaded?' }],
        isError: true,
      };
    }

    try {
      const servers = mgr.listServers();
      const tools = mgr.listTools(p.server);

      const lines: string[] = [];
      lines.push('=== MCP Servers ===');
      if (servers.length === 0) {
        lines.push('(no servers defined)');
      } else {
        for (const s of servers) {
          const flag = s.enabled ? '' : ' [disabled]';
          lines.push(`- ${s.name} [${s.status}${flag}] (${s.toolCount} tools)`);
        }
      }
      lines.push('');
      lines.push('=== MCP Tools ===');
      if (tools.length === 0) {
        lines.push('(no tools available)');
      } else {
        const grouped = new Map<string, typeof tools>();
        for (const t of tools) {
          const arr = grouped.get(t.server) ?? [];
          arr.push(t);
          grouped.set(t.server, arr);
        }
        for (const [serverName, serverTools] of grouped) {
          lines.push(`[${serverName}]`);
          for (const t of serverTools) {
            const title = t.title ? ` "${t.title}"` : '';
            const destructive = t.annotations?.destructiveHint === true ? ' [destructive]' : '';
            lines.push(`  - ${t.name}${title}${destructive}: ${t.description ?? '(no description)'}`);
          }
        }
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        metadata: { serverCount: servers.length, toolCount: tools.length },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error listing MCP: ${err instanceof Error ? err.message : err}` }],
        isError: true,
      };
    }
  },
};
