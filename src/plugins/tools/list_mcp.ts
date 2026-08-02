// src/plugins/tools/list_mcp.ts
// list_mcp 工具：列出所有已连接 MCP 服务器及工具清单。

import type { Tool, ToolResult } from './types';
import type { MCPManager } from '../contracts';
import { ServiceNames } from '../../core/types';

export const listMcpTool: Tool = {
  name: 'list_mcp',
  description:
    'List all connected MCP servers and their tools. ' +
    'If server is specified, only list tools from that server. ' +
    'Use this to discover what MCP tools are available before calling use_mcp.',
  inputSchema: {
    type: 'object',
    properties: {
      server: {
        type: 'string',
        description: 'Optional: only list tools from this specific server.',
      },
    },
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
  },
  async execute(params, ctx): Promise<ToolResult> {
    const p = params as { server?: string };

    const mgr = ctx.services.tryResolve<MCPManager>(ServiceNames.MCP_MANAGER);
    if (!mgr) {
      return {
        content: [{ type: 'text', text: 'MCP manager not available. Is the MCP plugin loaded?' }],
        isError: false,
      };
    }

    try {
      const servers = mgr.listServers();
      const tools = mgr.listTools(p.server);

      const lines: string[] = [];
      lines.push('=== MCP Servers ===');
      if (servers.length === 0) {
        lines.push('(no servers connected)');
      } else {
        for (const s of servers) {
          lines.push(`- ${s.name} [${s.status}] (${s.toolCount} tools)`);
        }
      }
      lines.push('');
      lines.push('=== MCP Tools ===');
      if (tools.length === 0) {
        lines.push('(no tools available)');
      } else {
        // 按 server 分组
        const grouped = new Map<string, typeof tools>();
        for (const t of tools) {
          const arr = grouped.get(t.server) ?? [];
          arr.push(t);
          grouped.set(t.server, arr);
        }
        for (const [serverName, serverTools] of grouped) {
          lines.push(`[${serverName}]`);
          for (const t of serverTools) {
            lines.push(`  - ${t.name}: ${t.description ?? '(no description)'}`);
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
