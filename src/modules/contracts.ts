// src/plugins/contracts.ts
// 跨插件服务接口契约。
// 各业务插件实现这些接口，通过 ServiceRegistry 注册；其他插件按需 resolve。
// 这样避免插件之间的直接依赖，所有跨插件通信都通过接口契约。

import type {
  UnifiedRequest,
  UnifiedResponse,
  StreamDelta,
} from './llm/types';
import type { Tool, ToolContext, ToolResult } from './tools/types';

// ============================================================================
// LLM Router（由 LLM 插件注册，ServiceNames.LLM_ROUTER）
// ============================================================================

export interface LLMRouter {
  /**
   * 发送非流式请求。
   * @param req 统一请求（req.model 为 ModelConfig.id 或 API 模型名）
   */
  complete(req: UnifiedRequest): Promise<UnifiedResponse>;

  /**
   * 发送流式请求。
   * @returns 异步迭代器，逐个产出 StreamDelta
   */
  stream(req: UnifiedRequest): AsyncIterable<StreamDelta>;
}

// ============================================================================
// Tool Registry（由 Tools 插件注册，ServiceNames.TOOL_REGISTRY）
// ============================================================================

export interface ToolRegistry {
  /** 注册工具 */
  register(tool: Tool): void;
  /** 注销工具 */
  unregister(name: string): void;
  /** 获取工具 */
  get(name: string): Tool | null;
  /** 列出所有工具 */
  list(): Tool[];
  /** 列出所有工具的 schema（供 LLM 注入） */
  listSchemas(): Array<{
    name: string;
    description: string;
    inputSchema: unknown;
    annotations?: Record<string, unknown>;
  }>;
  /** 执行工具 */
  execute(name: string, params: unknown, ctx: ToolContext): Promise<ToolResult>;
}

// ============================================================================
// Agent Engine（由 Agent 插件注册，ServiceNames.AGENT_ENGINE）
// ============================================================================

export interface AgentEngine {
  /**
   * 启动一轮对话（ReAct 循环）。
   * 流式事件通过 onEvent 回调推送。
   * @returns 最终的 assistant 消息
   */
  run(input: AgentRunInput): Promise<AgentRunResult>;

  /**
   * 前端回复 ask 工具的提问。
   * @returns true 表示匹配到 pending ask 并已 resolve；false 表示无匹配（可能已超时或不存在）。
   */
  resolveAsk(toolCallId: string, answer: string): boolean;
}

export interface AgentRunInput {
  sessionId: string;
  /** 用户最新输入文本 */
  userMessage: string;
  /** 模型名（可选，默认从配置） */
  model?: string;
  /** 工作目录 */
  cwd: string;
  /** 流式事件回调 */
  onEvent: (event: AgentEvent) => void;
  /** 中断信号 */
  signal?: AbortSignal;
}

export type AgentEvent =
  | { type: 'assistant-text'; sessionId: string; text: string }
  | { type: 'assistant-thinking'; sessionId: string; text: string }
  | { type: 'tool-call-start'; sessionId: string; toolName: string; toolCallId: string; args: unknown }
  | { type: 'tool-call-delta'; sessionId: string; toolCallId: string; argumentsDelta: string }
  | { type: 'tool-call-executing'; sessionId: string; toolName: string; toolCallId: string }
  | { type: 'tool-call-end'; sessionId: string; toolName: string; toolCallId: string; result: ToolResult }
  | { type: 'ask'; sessionId: string; toolCallId: string; question: string }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'done'; sessionId: string; finishReason: string };

export interface AgentRunResult {
  sessionId: string;
  finishReason: 'stop' | 'length' | 'error' | 'aborted';
  finalText: string;
  /** 完整的会话历史（含本轮） */
  history: AgentMessage[];
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    /** JSON 字符串（与 UnifiedToolCall.function.arguments 对齐） */
    arguments: string;
  }>;
  toolCallId?: string;
  thinking?: string;
  /** 工具名（role=tool 时，部分 provider 用 name 区分工具来源） */
  name?: string;
}

// ============================================================================
// MCP Manager（由 MCP 插件注册，ServiceNames.MCP_MANAGER）
// ============================================================================

export interface MCPManager {
  /** 列出所有已连接 MCP 服务器 */
  listServers(): Array<{ name: string; status: 'connected' | 'disconnected' | 'error'; toolCount: number }>;
  /** 列出指定服务器的工具 */
  listTools(serverName?: string): Array<{
    server: string;
    name: string;
    description?: string;
    inputSchema?: unknown;
  }>;
  /** 调用 MCP 工具 */
  callTool(serverName: string, toolName: string, args: unknown): Promise<{
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; data: string; mimeType: string }
      | { type: 'resource'; uri: string; mimeType?: string; text?: string; blob?: string }
    >;
    isError?: boolean;
  }>;
  /** 启动/重启指定服务器 */
  connect(serverName: string): Promise<void>;
  /** 断开指定服务器 */
  disconnect(serverName: string): Promise<void>;
  /** 重载所有服务器（配置变更后） */
  reloadAll(): Promise<void>;
}

// ============================================================================
// Server Instance（由 Server 插件注册，ServiceNames.SERVER_INSTANCE）
// ============================================================================

export interface ServerInstanceLike {
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  broadcastWS(message: unknown): void;
  sendToSession(sessionId: string, message: unknown): void;
}
