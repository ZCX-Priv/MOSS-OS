// tools/list_mcp/index.ts
// list_mcp 工具 execute 逻辑：列出所有 MCP 服务器（含启用状态）及工具清单。
// 元数据见同目录 tool.json。

import { t } from '../../../core/i18n';
import type { ToolContext, ToolResult } from '../types';
import type { MCPManager } from '../../contracts';
import { ServiceNames } from '../../../core/types';

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = params as { server?: string };

    const mgr = ctx.services.tryResolve<MCPManager>(ServiceNames.MCP_MANAGER);
    if (!mgr) {
      return {
        content: [{ type: 'text', text: `Error: ${t('tools.listMcpManagerUnavailable')}` }],
        isError: true,
      };
    }

    try {
      const servers = mgr.listServers();
      const tools = mgr.listTools(p.server);

      const lines: string[] = [];
      lines.push(t('tools.listMcpServersHeader'));
      if (servers.length === 0) {
        lines.push(t('tools.listMcpNoServers'));
      } else {
        for (const s of servers) {
          const flag = s.enabled ? '' : ` [${t('tools.listMcpDisabledFlag')}]`;
          lines.push(`- ${s.name} [${s.status}${flag}] (${t('tools.listMcpToolCount', { count: s.toolCount })})`);
        }
      }
      lines.push('');
      lines.push(t('tools.listMcpToolsHeader'));
      if (tools.length === 0) {
        lines.push(t('tools.listMcpNoTools'));
      } else {
        const grouped = new Map<string, typeof tools>();
        for (const mcpTool of tools) {
          const arr = grouped.get(mcpTool.server) ?? [];
          arr.push(mcpTool);
          grouped.set(mcpTool.server, arr);
        }
        for (const [serverName, serverTools] of grouped) {
          lines.push(`[${serverName}]`);
          for (const tool of serverTools) {
            const title = tool.title ? ` "${tool.title}"` : '';
            const destructive = tool.annotations?.destructiveHint === true ? ` [${t('tools.listMcpDestructiveFlag')}]` : '';
            lines.push(`  - ${tool.name}${title}${destructive}: ${tool.description ?? t('tools.listMcpNoDescription')}`);
          }
        }
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        metadata: { serverCount: servers.length, toolCount: tools.length },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: t('tools.listMcpFailed', { message: err instanceof Error ? err.message : String(err) }) }],
        isError: true,
      };
    }
  },
};
