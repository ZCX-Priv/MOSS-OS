// src/plugins/agent/context.ts
// 系统提示词构建 + 工具描述注入。

import type { UnifiedMessage, UnifiedTool } from '../llm/types';
import type { ToolRegistry } from '../contracts';
import type { Environment } from '../../core/types';

const BASE_SYSTEM_PROMPT = `You are MOSS-OS, an interactive AI agent operating in a real environment.

You have access to tools that let you read/write files, execute shell commands, invoke skills, and call MCP servers.

# Core Principles
1. **First principles**: Reason from fundamentals, not surface patterns.
2. **Honesty**: Never fabricate. If unsure, say so. Back suggestions with evidence.
3. **Minimal change**: Do exactly what's asked. No unrequested refactors, docs, or features.
4. **Safety first**: Destructive operations require explicit user confirmation.
5. **Tool discipline**: Use tools to gather information before claiming facts about the environment.

# Working Directory
You operate relative to the user's working directory. Use \`read\` to inspect files, \`shell\` to run commands, \`edit\` to make precise edits, \`write\` to create new files.

# Response Format
- Be concise. Lead with the answer or action, not the reasoning.
- When using tools, explain briefly what you're doing and why.
- After tool execution, summarize the result and proceed.

# Environment
- Platform: {{PLATFORM}}
- Working directory: {{CWD}}`;

export function buildSystemPrompt(env: Environment, cwd: string): string {
  return BASE_SYSTEM_PROMPT
    .replace('{{PLATFORM}}', env.platform)
    .replace('{{CWD}}', cwd);
}

/**
 * 把 ToolRegistry 中的工具 schema 转换为 UnifiedTool 数组，供 LLM 注入。
 * 同时注入 MCP 工具（若 MCPManager 已注册）。
 */
export function buildTools(
  toolRegistry: ToolRegistry | null,
  mcpTools?: Array<{ server: string; name: string; description?: string; inputSchema?: unknown }>,
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

  // MCP 工具（用 mcp__server__tool 前缀，避免命名冲突）
  if (mcpTools) {
    for (const t of mcpTools) {
      const toolName = `mcp__${t.server}__${t.name}`;
      tools.push({
        type: 'function',
        function: {
          name: toolName,
          description: `[MCP:${t.server}] ${t.description ?? t.name}`,
          parameters: t.inputSchema ?? { type: 'object', properties: {}, additionalProperties: true },
        },
      });
    }
  }

  return tools;
}

/** 把 tools 列表转为人类可读描述（用于无工具调用能力的 provider） */
export function describeTools(tools: UnifiedTool[]): string {
  if (tools.length === 0) return '';
  const lines = tools.map(t => `- ${t.function.name}: ${t.function.description}`);
  return '\n\n# Available Tools\n' + lines.join('\n');
}
