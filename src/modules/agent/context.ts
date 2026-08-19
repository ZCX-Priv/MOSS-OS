// src/modules/agent/context.ts
// 工具描述注入（工具 schema 构建）。
// 系统提示词构建已迁入 context 引擎（compiler/system-prompt.ts：静态前缀 + 缓存对齐布局）。

import type { UnifiedTool } from '../llm/types';
import type { ToolRegistry } from '../contracts';

/**
 * 把 ToolRegistry 中的工具 schema 转换为 UnifiedTool 数组，供 LLM 注入。
 * 同时注入 MCP 工具（若 MCPManager 已注册）。
 */
export function buildTools(
  toolRegistry: ToolRegistry | null,
  mcpTools?: Array<{
    server: string;
    name: string;
    title?: string;
    description?: string;
    inputSchema?: unknown;
  }>,
): UnifiedTool[] {
  const tools: UnifiedTool[] = [];

  // 内置工具
  if (toolRegistry) {
    for (const t of toolRegistry.listSchemas()) {
      tools.push({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      });
    }
  }

  // MCP 工具（用 mcp__server__tool 前缀，避免命名冲突；title 附加到描述）
  if (mcpTools) {
    for (const t of mcpTools) {
      const toolName = `mcp__${t.server}__${t.name}`;
      const titleSuffix = t.title && t.title !== t.name ? ` "${t.title}"` : '';
      tools.push({
        type: 'function',
        function: {
          name: toolName,
          description: `[MCP:${t.server}${titleSuffix}] ${t.description ?? t.name}`,
          parameters: t.inputSchema ?? { type: 'object', properties: {}, additionalProperties: true },
        },
      });
    }
  }

  return tools;
}
