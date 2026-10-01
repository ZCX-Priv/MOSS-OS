// webui/src/components/agenteam/agent-calls.ts
// 对话流中 agent 工具调用的统一识别与结果解析。
//
// 为什么要集中：卡片分派此前只靠 `tc.name === 'agent'` 单点判断，一旦工具名有偏差
// （历史会话 / 命名空间化 / Provider 改写）就掉进通用折叠卡且没有任何兜底。
// 另外长耗时工具（subagent / 建队）的结果消息会落在会话很后面，邻近匹配拿不到结果。

import type { TaskMessage, ToolCall } from '../../types/api';

/** agent 工具参数（宽松解析，未知字段忽略） */
export interface AgentCallArgs {
  mode?: string;
  /** subagent：模板 agent id */
  template?: string;
  /** subagent：任务描述 */
  task?: string;
  /** agenteam create：团队名 */
  name?: string;
  /** agenteam create：成员 */
  members?: Array<{ name?: string; role?: string; agentId?: string }>;
  /** agenteam create：任务 */
  tasks?: Array<{ subject?: string; assignee?: string }>;
  /** agenteam：操作 */
  action?: string;
}

/** 容错解析工具调用参数；非对象或解析失败返回 null */
export function parseAgentArgs(tc: ToolCall): AgentCallArgs | null {
  try {
    const parsed = JSON.parse(tc.arguments || '{}') as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as AgentCallArgs;
  } catch {
    return null;
  }
}

/**
 * 是否属于 agent 工具的调用（渲染为专属卡片）。
 * 主判据是工具名；同时用参数结构兜底，避免改名/历史会话导致掉卡。
 */
export function isAgentCall(tc: ToolCall): boolean {
  if (tc.name === 'agent') return true;
  const args = parseAgentArgs(tc);
  if (!args) return false;
  if (args.mode === 'subagent' || args.mode === 'agenteam') return true;
  return typeof args.template === 'string' && typeof args.task === 'string';
}

/** 工具结果解析产物 */
export interface ToolResultEntry {
  text: string;
  isError: boolean;
}

/**
 * 跨整条消息列表建立 toolCallId → 结果索引。
 * 长耗时工具的结果消息不保证紧邻其 assistant 消息，必须全局匹配。
 */
export function buildToolResultIndex(
  messages: readonly TaskMessage[],
): Map<string, ToolResultEntry> {
  const index = new Map<string, ToolResultEntry>();
  for (const message of messages) {
    const results = message.toolResults;
    if (!results || results.length === 0) continue;
    for (const entry of results) {
      if (!entry.toolCallId || index.has(entry.toolCallId)) continue;
      const text = entry.result.content
        .filter((c) => c.type === 'text')
        .map((c) => (c.type === 'text' ? c.text : ''))
        .join('\n');
      index.set(entry.toolCallId, { text, isError: entry.result.isError === true });
    }
  }
  return index;
}
