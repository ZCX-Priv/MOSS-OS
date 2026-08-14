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
import type { TodoItem } from './tools/todo';
import type {
  FileHistoryEntry,
  TrackEditResult,
  UndoResult,
} from './file-history/types';

// ============================================================================
// LLM Router（由 LLM 插件注册，ServiceNames.LLM_ROUTER）
// ============================================================================

export interface LLMRouter {
  /**
   * 发送非流式请求。
   * @param req 统一请求（req.model 为 ModelConfig.id 或 API 模型名）
   * @param signal 中断信号，传入后底层 HTTP 请求可被外部 abort
   */
  complete(req: UnifiedRequest, signal?: AbortSignal): Promise<UnifiedResponse>;

  /**
   * 发送流式请求。
   * @param signal 中断信号，传入后底层 HTTP 请求可被外部 abort
   * @returns 异步迭代器，逐个产出 StreamDelta
   */
  stream(req: UnifiedRequest, signal?: AbortSignal): AsyncIterable<StreamDelta>;
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
  /** 判断工具是否启用（从 config.tools[name].enabled 读取，缺失默认 true） */
  isEnabled(name: string): boolean;
  /** 执行工具 */
  execute(name: string, params: unknown, ctx: ToolContext): Promise<ToolResult>;
}

// ============================================================================
// Agent Engine（由 Agent 插件注册，ServiceNames.AGENT_ENGINE）
// ============================================================================

export interface AgentEngine {
  /**
   * 启动一轮任务（ReAct 循环）。
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
  /** Agent 配置 ID（可选；指定后按该 Agent 的 systemPrompt/model/tools/maxTurns/maxTokens 执行） */
  agentId?: string;
  /** 工作目录 */
  cwd: string;
  /** 流式事件回调 */
  onEvent: (event: AgentEvent) => void;
  /** 中断信号 */
  signal?: AbortSignal;
  /** 运行实例 ID（前端生成，用于隔离不同 run 的事件） */
  runId?: string;
}

export type AgentEvent =
  | { type: 'assistant-text'; sessionId: string; text: string; runId?: string }
  | { type: 'assistant-thinking'; sessionId: string; text: string; runId?: string }
  | { type: 'tool-call-start'; sessionId: string; toolName: string; toolCallId: string; args: unknown; runId?: string }
  | { type: 'tool-call-delta'; sessionId: string; toolCallId: string; argumentsDelta: string; runId?: string }
  | { type: 'tool-call-executing'; sessionId: string; toolName: string; toolCallId: string; runId?: string }
  | { type: 'tool-call-end'; sessionId: string; toolName: string; toolCallId: string; result: ToolResult; runId?: string }
  | { type: 'ask'; sessionId: string; toolCallId: string; question: string; runId?: string }
  | { type: 'error'; sessionId: string; message: string; runId?: string }
  | { type: 'done'; sessionId: string; finishReason: string; runId?: string };

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
  /** 该 assistant 消息内 todo 工具调用完成时的 todos 快照（用于前端按调用时刻渲染） */
  todoSnapshot?: TodoItem[];
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

// ============================================================================
// File History Service（由 file-history 模组注册，ServiceNames.FILE_HISTORY）
// 三层文件历史架构：Track Edit（改前备份）+ Snapshot（每轮快照）+ JSONL 持久化
// ============================================================================

export interface FileHistoryService {
  /**
   * Layer 1：改前备份（同步阻塞，必须在文件修改前调用）。
   * - 文件不存在 → operation='create'，不备份
   * - 文件存在 → operation='overwrite'/'edit'，按内容哈希备份（同内容去重）
   * @returns 备份结果（含 entryId 用于 restore）
   */
  trackEdit(
    sessionId: string,
    absPath: string,
    toolCallId: string,
    toolName: 'write' | 'edit' | 'delete',
  ): Promise<TrackEditResult>;

  /**
   * 在文件变更后记录历史条目（写入 transcript）。
   * 由 write/edit/delete 工具在变更完成后调用，传入变更后的内容 sha。
   */
  recordChange(
    sessionId: string,
    absPath: string,
    trackResult: TrackEditResult,
    hashAfter: string,
    bytesAfter: number,
    diff?: string,
  ): void;

  /** 校验本会话是否 read 过该文件（read-before-mutate 约束） */
  isRead(sessionId: string, absPath: string): boolean;

  /** 标记文件已被 read（read 工具调用时注册，传入内容 sha） */
  markRead(sessionId: string, absPath: string, sha: string): void;

  /** Layer 2：创建快照（每轮 LLM 响应后异步调用）。当前实现为 no-op，预留扩展点。 */
  createSnapshot(sessionId: string): Promise<void>;

  /** 撤销最近 N 次文件变更（默认 1 次）。从备份恢复原内容。 */
  undo(sessionId: string, steps?: number): Promise<UndoResult>;

  /** 列出某会话的文件历史（前端 UI 用） */
  listHistory(sessionId: string): FileHistoryEntry[];

  /** 恢复到指定历史条目（前端 UI 用，撤销该条目对应的变更） */
  restore(sessionId: string, entryId: string): Promise<UndoResult>;

  /** 清理会话资源（会话结束时调用，清空内存 ledger） */
  clearSession(sessionId: string): void;
}
