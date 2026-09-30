// tools/mcp/index.ts
// mcp 工具 execute 逻辑：统一 MCP 工具，按 action 分派。
//   list —— 列出所有 MCP 服务器（含启用状态）及工具清单（可用 server 限定）
//   call —— 转发到指定 MCP 服务器的指定工具
// 元数据见同目录 tool.json。

import { t } from '../../../core/i18n';
import type { ToolContext, ToolResult } from '../types';
import type { MCPManager } from '../../contracts';
import { ServiceNames } from '../../../core/types';

interface McpParams {
  action?: string;
  server?: string;
  tool?: string;
  arguments?: unknown;
}

function errorText(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** action=list：列出 MCP 服务器及工具（可选 server 过滤） */
function runList(p: McpParams, ctx: ToolContext): ToolResult {
  const mgr = ctx.services.tryResolve<MCPManager>(ServiceNames.MCP_MANAGER);
  if (!mgr) {
    return errorText(`Error: ${t('tools.listMcpManagerUnavailable')}`);
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
    return errorText(t('tools.listMcpFailed', { message: err instanceof Error ? err.message : String(err) }));
  }
}

/** action=call：调用指定 MCP 服务器上的工具 */
async function runCall(p: McpParams, ctx: ToolContext): Promise<ToolResult> {
  if (!p.server || !p.tool) {
    return errorText(`Error: ${t('tools.useMcpServerRequired')}`);
  }

  const mgr = ctx.services.tryResolve<MCPManager>(ServiceNames.MCP_MANAGER);
  if (!mgr) {
    return errorText(`Error: ${t('tools.useMcpManagerUnavailable')}`);
  }

  // server 启用检查（disabled / 未定义 → 拒绝）
  if (mgr.isServerEnabled(p.server) !== true) {
    return errorText(`Error: ${t('tools.useMcpServerDisabled', { server: p.server })}`);
  }

  try {
    // 超时：优先 toolConfig.timeout（config.tools.mcp），回退 config.mcp.callTimeoutMs（120s）
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
    return errorText(t('tools.useMcpCallFailed', {
      server: p.server,
      tool: p.tool,
      message: err instanceof Error ? err.message : String(err),
    }));
  }
}

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = (params ?? {}) as McpParams;
    switch (p.action) {
      case 'list':
        return runList(p, ctx);
      case 'call':
        return runCall(p, ctx);
      default:
        return errorText('Error: action must be one of list, call');
    }
  },
};