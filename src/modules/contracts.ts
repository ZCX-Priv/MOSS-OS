// src/modules/contracts.ts
// 跨模块服务接口契约。
// 各业务模块实现这些接口，通过 ServiceRegistry 注册；其他模块按需 resolve。
// 这样避免模块之间的直接依赖，所有跨模块通信都通过接口契约。

import type {
  UnifiedRequest,
  UnifiedResponse,
  StreamDelta,
} from './llm/types';
import type { Tool, ToolContext, ToolResult, AskPayload, AskOutcome } from './tools/types';
import type { TodoItem } from './tools/todo/shared/store';
import type {
  FileHistoryEntry,
  TrackRequest,
  ChangeTracker,
  UndoResult,
} from './file-history/types';
export type { FilesysService, ShellChangeReport } from './filesys/types';
import type { PermissionMode, SafetyDecision, SafetyRequest } from './safety/types';
export type { PermissionMode, SafetyDecision, SafetyRequest } from './safety/types';

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
// Context Engine（由 Context 插件注册，ServiceNames.CONTEXT_ENGINE）
// ============================================================================

import type {
  CompactPreview,
  CompactionRecord,
  ContextSessionLike,
  ContextStats,
  HealResult,
  ManualCompactResult,
  PreparedRequest,
  SessionStoreBridge,
} from './context/types';

/** agent 引擎调用 prepareRequest 的输入参数 */
export interface ContextPrepareOptions {
  cwd: string;
  /** 主模型请求名 */
  model: string;
  modelDisplayName: string;
  /** 上下文窗口 token（缺省由引擎从模型配置解析） */
  windowTokens?: number;
}

/**
 * 上下文引擎服务契约（基础设施级：拼接/压缩/自愈/预算/治理/遥测）。
 * agent 模块为调用方：run 循环每轮调用 prepareRequest，工具执行前调用 healToolCall。
 */
export interface ContextEngine {
  /** 每轮 LLM 请求前的统一流水线（env 保障 → 压缩决策 → 视图构建） */
  prepareRequest(session: ContextSessionLike, opts: ContextPrepareOptions): Promise<PreparedRequest>;
  /** 工具调用自愈：参数修复 → 工具名纠正 → schema 校验修正 */
  healToolCall(toolName: string, args: string): HealResult;
  /** agent 模块注入会话存取桥（get/persist；依赖方向 agent → context） */
  bindSessionStore(bridge: SessionStoreBridge): void;
  /** run 开始/结束的 busy 标记（手动压缩仅空闲可用） */
  markBusy(sessionId: string): void;
  markIdle(sessionId: string): void;
  /** engine 每轮流结束后上报 usage（缓存命中采样 + tokPerChar 校准 + 最近一次真实 usage 记录） */
  onTurnUsage(
    sessionId: string,
    usage: { promptTokens: number; cachedTokens: number; completionTokens?: number },
  ): void;
  /** 手动压缩（空闲时；focus 为附加焦点） */
  manualCompact(sessionId: string, focus?: string): Promise<ManualCompactResult>;
  /** 手动压缩预览（确认框数据） */
  previewCompact(sessionId: string): CompactPreview | null;
  /** 会话上下文统计（token 构成/缓存命中/压缩状态/系统分段） */
  getStats(sessionId: string): ContextStats | null;
  /** 压缩历史 */
  getCompactions(sessionId: string): CompactionRecord[];
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
   * 创建真实任务（侧边栏可见；task.id 即 sessionId）。
   * automation 等后台模块用它把运行挂到真实任务上。
   */
  createTask(title: string, groupId?: string): import('./agent/task-store').TaskItem;

  /** 列出全部分组（automation 按 cwd 派生文件夹分组用） */
  listTaskGroups(): import('./agent/task-store').TaskGroup[];

  /** 创建分组（source='folder' 的空组由 task-store 自动销毁） */
  createTaskGroup(name: string, source?: 'folder' | 'manual'): import('./agent/task-store').TaskGroup;

  /**
   * 前端回复 ask 工具的提问（accept=已回答 / cancel=取消）。
   * @returns true 表示匹配到 pending ask 并已 resolve；false 表示无匹配（可能已超时或不存在）。
   */
  resolveAsk(toolCallId: string, outcome: AskOutcome): boolean;

  /**
   * 前端回复 confirm 确认。
   * @param remember 「始终允许」级别：session=写会话规则（内存）；global=写 config.safety.rules（持久）
   * @returns true 表示匹配到 pending confirm 并已 resolve；false 表示无匹配（可能已超时或不存在）。
   */
  resolveConfirm(toolCallId: string, ok: boolean, remember?: 'session' | 'global'): boolean;

  /**
   * 消息撤回预览（dryRun）：定位目标用户消息，列出将被删除的消息与将被回滚的文件变更。
   * @param sessionId 会话 ID
   * @param messageTimestamp 前端用户消息的 timestamp（定位依据；找不到时回退 content 匹配）
   * @param content 用户消息文本（timestamp 定位失败时的回退依据）
   */
  previewTruncate(
    sessionId: string,
    messageTimestamp: string,
    content: string,
  ): TruncatePreview | null;

  /**
   * 执行消息撤回（截断）：软删除目标用户消息及其后全部消息，
   * 并联动 file-history 回滚该区间内 AI 产生的文件变更（回滚前自动备份，支持 redo）。
   * 成功后向该 session 推送 session-truncated WS 事件。
   */
  truncateFrom(sessionId: string, messageTimestamp: string, content: string): Promise<TruncateResult | null>;

  /**
   * 恢复最近一次消息撤回（redo）：清除软删除标记 + 从回滚备份恢复文件。
   * 成功后向该 session 推送 session-restored WS 事件。
   */
  restoreTruncate(sessionId: string): Promise<TruncateRestoreResult | null>;
}

export interface AgentRunInput {
  sessionId: string;
  /** 用户最新输入文本 */
  userMessage: string;
  /** 模型名（可选，默认从配置） */
  model?: string;
  /** Agent 配置 ID（可选；指定后按该 Agent 的 systemPrompt/model/tools/maxTurns/maxTokens/maxTokens 执行） */
  agentId?: string;
  /**
   * 权限模式（前端 PermissionModeSelector 会话级传递）：
   * 'ask'=手动审批 / 'auto'=自动审批（L2 放行 L3 确认） / 'skip'=完全访问（仅查禁用）
   */
  permissionMode?: PermissionMode;
  /** 工作目录 */
  cwd: string;
  /** 流式事件回调 */
  onEvent: (event: AgentEvent) => void;
  /** 中断信号 */
  signal?: AbortSignal;
  /** 运行实例 ID（前端生成，用于隔离不同 run 的事件） */
  runId?: string;
  /** 引导消息队列（引导模式下，工具调用完成后检查并中止当前 run） */
  guideMessages?: string[];
}

/**
 * 单次运行（run）级统计（每次用户发送消息后重置，跨轮累加）。
 * 前端中控台指标栏数据源：
 * - turns/steps：LLM 调用轮数 / 工具调用步数
 * - llmMs/toolMs：LLM 流式调用总耗时 / 工具执行总耗时
 * - ttftCount+ttftMsTotal：首 token 延迟样本（平均 = total/count）
 * - decodeMs：Σ(轮耗时−轮TTFT)，tok/s = outputTokens/decodeMs
 * - cachedTokens/inputTokens：缓存命中率 = cached/input（token 加权）
 */
export interface RunStats {
  runId?: string;
  turns: number;
  /** 本次 run 的轮数（每次 run 重置；与 turns 的会话级累计口径区分，供 X/N 进度显示） */
  runTurns: number;
  steps: number;
  llmMs: number;
  toolMs: number;
  ttftCount: number;
  ttftMsTotal: number;
  decodeMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export type AgentEvent =
  | { type: 'assistant-text'; sessionId: string; text: string; runId?: string }
  | { type: 'assistant-thinking'; sessionId: string; text: string; runId?: string }
  | { type: 'tool-call-start'; sessionId: string; toolName: string; toolCallId: string; args: unknown; runId?: string }
  | { type: 'tool-call-delta'; sessionId: string; toolCallId: string; argumentsDelta: string; runId?: string }
  | { type: 'tool-call-executing'; sessionId: string; toolName: string; toolCallId: string; runId?: string }
  | { type: 'tool-call-end'; sessionId: string; toolName: string; toolCallId: string; result: ToolResult; runId?: string }
  | { type: 'ask'; sessionId: string; toolCallId: string; question: string; answerType?: AskPayload['answerType']; options?: AskPayload['options']; defaultAnswer?: string; formSchema?: Record<string, unknown>; runId?: string }
  | { type: 'ask-timeout'; sessionId: string; toolCallId: string; runId?: string }
  | { type: 'confirm-required'; sessionId: string; toolCallId: string; toolName: string; question: string; details?: unknown; runId?: string; ruleSuggestion?: string }
  | { type: 'skill-mode'; sessionId: string; action: 'enter' | 'switch' | 'exit' | 'error'; name?: string; greet?: string; icon?: string; message?: string; runId?: string }
  | { type: 'stats-updated'; sessionId: string; stats: RunStats; runId?: string }
  | { type: 'error'; sessionId: string; message: string; runId?: string }
  | { type: 'done'; sessionId: string; finishReason: string; runId?: string };

export interface AgentRunResult {
  sessionId: string;
  /** max_turns = 达到工具调用最大轮数上限（agent.maxTurns） */
  finishReason: 'stop' | 'length' | 'error' | 'aborted' | 'max_turns';
  finalText: string;
  /** 完整的会话历史（含本轮） */
  history: AgentMessage[];
  /** 引导中止标记：工具调用完成后检测到引导消息，需自动启动新 run */
  guideInterrupt?: boolean;
  /** 引导消息内容（引导中止时携带，供 WsHandler 启动新 run） */
  guideMessage?: string;
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
  /** 工具结果是否为错误（role=tool 时；持久化用于前端刷新恢复错误样式） */
  isError?: boolean;
  /** 工具结果元信息（role=tool 时；如 command/cwd/exitCode/structuredContent/resources） */
  metadata?: Record<string, unknown>;
  /** 该 assistant 消息内 todo 工具调用完成时的 todos 快照（用于前端按调用时刻渲染） */
  todoSnapshot?: TodoItem[];
  /** 消息创建时间（ISO 8601；旧数据可能缺失）。消息撤回的时间区间定位依据 */
  timestamp?: string;
  /** 软删除时间（ISO 8601）。非空表示已被消息撤回截断，构建 LLM 上下文时过滤 */
  deletedAt?: string;
}

/** 消息撤回（截断）预览结果 */
export interface TruncatePreview {
  /** 将被删除的消息（含目标用户消息及其后全部） */
  messagesToRemove: Array<{ index: number; role: string; content: string; timestamp?: string }>;
  /** 将被回滚的文件变更（来自 file-history transcript 时间区间） */
  fileChanges: Array<{ absPath: string; operation: string; toolName: string; timestamp: string }>;
  /** 文件回滚被跳过的原因（诚实降级：不再静默跳过，前端如实提示） */
  rollbackSkippedReason?: 'no-file-history' | 'no-timestamp';
}

/** 消息撤回（截断）执行结果 */
export interface TruncateResult {
  /** 被软删除的消息数 */
  removedCount: number;
  /** 成功回滚的文件数 */
  rolledBackFiles: number;
  /** 回滚失败的条目 */
  rollbackFailed: Array<{ absPath: string; error: string }>;
  /** 截断起点时间戳（前端据此删除本地消息） */
  truncatedBeforeTimestamp: string;
  /** 是否回滚了文件变更 */
  fileRollbackPerformed: boolean;
  /** 文件回滚被跳过的原因（诚实降级：不再静默跳过，前端如实提示） */
  rollbackSkippedReason?: 'no-file-history' | 'no-timestamp';
}

/** 消息撤回恢复（redo）结果 */
export interface TruncateRestoreResult {
  /** 恢复的消息数 */
  restoredCount: number;
  /** 成功恢复的文件数 */
  restoredFiles: number;
  /** 恢复失败的条目 */
  restoreFailed: Array<{ absPath: string; error: string }>;
}

// ============================================================================
// MCP Manager（由 MCP 插件注册，ServiceNames.MCP_MANAGER）
// ============================================================================

/** MCP 工具注解（从 MCP 服务器透传） */
export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface MCPManager {
  /** 列出所有已定义 MCP 服务器（含未连接与禁用） */
  listServers(): Array<{
    name: string;
    status: 'connected' | 'disconnected' | 'error';
    toolCount: number;
    enabled: boolean;
    transport?: string;
  }>;
  /** 列出指定服务器的工具（仅已连接且启用的服务器；透传 annotations/title） */
  listTools(serverName?: string): Array<{
    server: string;
    name: string;
    title?: string;
    description?: string;
    inputSchema?: unknown;
    annotations?: McpToolAnnotations;
  }>;
  /** 查询某服务器定义的启用状态（未定义返回 null） */
  isServerEnabled(serverName: string): boolean | null;
  /** 查询某 MCP 工具的注解（server 未连接或工具不存在返回 null） */
  getToolAnnotations(serverName: string, toolName: string): McpToolAnnotations | null;
  /** 调用 MCP 工具（structured 输出与 resource 完整保留；opts 控制超时/中断/elicitation） */
  callTool(
    serverName: string,
    toolName: string,
    args: unknown,
    opts?: {
      timeoutMs?: number;
      signal?: AbortSignal;
      /** elicitation 桥：MCP 服务器向用户请求输入（缺省时 decline） */
      elicit?: (req: {
        message: string;
        requestedSchema?: Record<string, unknown>;
      }) => Promise<
        | { action: 'accept'; content: Record<string, string | number | boolean> }
        | { action: 'decline' }
        | { action: 'cancel' }
      >;
    },
  ): Promise<{
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; data: string; mimeType: string }
      | { type: 'resource'; uri: string; mimeType?: string; text?: string; blob?: string }
    >;
    isError?: boolean;
    /** MCP structured output（2025-06-18 规范），存在时优先于 text 解析 */
    structured?: unknown;
  }>;
  /** 启动/重启指定服务器 */
  connect(serverName: string): Promise<void>;
  /** 断开指定服务器 */
  disconnect(serverName: string): Promise<void>;
  /** 重载所有服务器（配置变更后） */
  reloadAll(): Promise<void>;
  /** 新建服务器定义（写 ~/.moss/mcps/<name>.json 并尝试连接） */
  createServer(name: string, def: unknown): Promise<void>;
  /** 更新服务器定义（写回文件，目录 watch 自动 reload） */
  updateServer(name: string, def: unknown): Promise<void>;
  /** 删除服务器定义（先断开，再删 ~/.moss/mcps/<name>.json） */
  deleteServer(name: string): Promise<void>;
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
// File History Service（由 file-history 模块注册，ServiceNames.FILE_HISTORY）
// 三层文件历史架构：Track（统一变更追踪）+ Snapshot（每轮快照）+ JSONL 持久化
// ============================================================================

export interface FileHistoryService {
  /**
   * 统一变更追踪入口（tracker 对象模式）：变更前调用（shell 为事后回填调用）。
   * 内部按 toolName 分发：write/edit/delete 做改前备份（文件不存在记 create 收据）；
   * move/copy 构造无备份收据；shell 按 shellBefore 缓存内容回填备份。
   * @returns ChangeTracker：变更后调 tracker.commit(after) 登记历史条目；
   *          变更失败不调 commit 即丢弃（孤儿备份由 retention 回收）。
   *          enabled=false 时返回 no-op tracker。
   */
  track(req: TrackRequest): Promise<ChangeTracker>;

  /** 校验本会话是否 read 过该文件（read-before-mutate 约束） */
  isRead(sessionId: string, absPath: string): boolean;

  /** 标记文件已被 read（read 工具调用时注册，传入内容 sha） */
  markRead(sessionId: string, absPath: string, sha: string): void;

  /** Layer 2：创建快照（每轮 LLM 响应后异步调用）。当前实现为 no-op，预留扩展点。 */
  createSnapshot(sessionId: string): Promise<void>;

  /** 撤销最近 N 次文件变更（默认 1 次）。先恢复成功再移除条目，失败条目保留可重试。 */
  undo(sessionId: string, steps?: number): Promise<UndoResult>;

  /** 列出某会话的文件历史（前端 UI 用；含已回滚标记条目） */
  listHistory(sessionId: string): FileHistoryEntry[];

  /**
   * 回滚时间区间内的全部文件变更（消息撤回联动，标记制）。
   * Phase 1 全量 redo 备份（不动文件）；Phase 2 逆序恢复，成功才追加
   * toolName='rollback' 的 R 条目（含 rollbackOf 反向引用）并给原始条目打
   * rolledBackAt 标记（不物理删除，redo 后清除标记，支持无限次撤回/恢复循环）。
   * @returns rollback entry id 列表（供 redoRollback）
   */
  rollbackRange(sessionId: string, fromTs: string, toTs: string): Promise<{
    rollbackIds: string[];
    failed: Array<{ absPath: string; error: string }>;
  }>;

  /**
   * 恢复一次回滚（redo）：按 rollbackOf 配对——单条 R 恢复成功则移除该 R
   * 并清除对应原始条目的 rolledBackAt 标记；失败的 R 保留（可重试）。
   */
  redoRollback(sessionId: string, rollbackIds: string[]): Promise<{
    failed: Array<{ absPath: string; error: string }>;
  }>;

  /** 恢复到指定历史条目（前端 UI 用，撤销该条目对应的变更；拒绝已回滚/R 条目） */
  restore(sessionId: string, entryId: string): Promise<UndoResult>;

  /** 清理会话资源（会话结束时调用，清空内存 ledger） */
  clearSession(sessionId: string): void;

  /** 获取回收站目录路径（供 delete 工具 trash 模式调用 moveToTrash） */
  getTrashDir(): string;
}

// ============================================================================
// Safety Service（由 safety 模块注册，ServiceNames.SAFETY）
// 统一权限决策入口：所有工具（builtin/custom/MCP/use_mcp）执行前必须经过 evaluate。
// ============================================================================

export interface SafetyService {
  /** 全局默认权限模式（config.safety.defaultMode） */
  getDefaultMode(): PermissionMode;
  /** 确认超时（分钟；0=永不超时） */
  getConfirmTimeoutMinutes(): number;
  /** 统一权限决策（allow=放行 / ask=需用户确认 / deny=拒绝） */
  evaluate(req: SafetyRequest): SafetyDecision;
  /** 添加会话级规则（「始终允许(会话)」；内存存储，刷新失效） */
  addSessionRule(sessionId: string, list: 'allow' | 'deny' | 'ask', rule: string): void;
  /** 清理会话规则（会话删除时调用） */
  clearSessionRules(sessionId: string): void;
  /** 添加全局持久规则（「始终允许(全局)」→ config.safety.rules + 广播 config:changed） */
  addGlobalRule(list: 'allow' | 'deny' | 'ask', rule: string): Promise<boolean>;
  /** 生成「始终允许」规则建议（shell 智能前缀 / MCP 全名 / 工具名） */
  generateRuleSuggestion(toolName: string, params: unknown): string;
}
