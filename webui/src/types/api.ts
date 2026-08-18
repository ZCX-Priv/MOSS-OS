// UI/src/types/api.ts
// 前后端共享 API 类型定义（前后端对接契约的单一真相源）
// 依据 docs/frontend-backend-api.md 第五章

// ============================================================================
// 基础类型（从旧前端 webui/src/types/index.ts 迁移）
// ============================================================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  status?: 'generating' | 'executing' | 'done';
}

export interface ToolResult {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; source: { data: string; mimeType: string } }
  >;
  isError?: boolean;
  /** 工具元数据（后端 shell 等工具运行时返回，含 command/cwd/exitCode 等） */
  metadata?: {
    command?: string;
    cwd?: string;
    exitCode?: number;
    stdoutLength?: number;
    stderrLength?: number;
    truncated?: boolean;
    timedOut?: boolean;
    /** MCP 工具来源（mcp__server__tool） */
    server?: string;
    tool?: string;
    /** MCP structuredContent（结构化输出，JSON 直显） */
    structuredContent?: Record<string, unknown>;
    /** MCP resource 引用（uri/mimeType/text 完整数据） */
    resources?: Array<{ uri: string; mimeType?: string; text?: string }>;
  };
}

/** 会话当前激活的 skill 模式（skill-mode 事件维护） */
export interface ActiveSkillState {
  name: string;
  icon?: string;
  greet?: string;
}

/** 右侧边栏标签页类型 */
export type SidebarTabType = 'summary' | 'terminal';

/** 右侧边栏标签页 */
export interface SidebarTab {
  id: string;
  type: SidebarTabType;
  /** 标题 i18n key（如 'task.taskSummary' / 'terminal.title'） */
  title: string;
  /** 仅 terminal 类型：绑定特定 toolCallId（可选，缺省显示当前 session 所有 shell 调用） */
  toolCallId?: string;
  createdAt: number;
}

export interface TaskMessage {
  id: string;
  role: MessageRole;
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  toolResults?: Array<{ toolCallId: string; result: ToolResult }>;
  timestamp: string;
  /** 是否正在流式生成（整体） */
  streaming?: boolean;
  /** thinking 是否仍在输出（独立于 streaming，用于 thinking 区转圈） */
  thinkingStreaming?: boolean;
  /** 该消息内 todo 工具调用完成时的 todos 快照（任务流内卡片按此渲染，避免共享实时状态） */
  todoSnapshot?: TodoItem[];
  /** 是否为错误消息（用于错误卡片渲染） */
  isError?: boolean;
}

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

// ============================================================================
// 配置类型（与后端 src/core/types.ts 对齐）
// ============================================================================

export interface AppConfig {
  version: number;
  server: { host: string; port: number; autoPort: boolean; locale?: string };
  daemon: { enabled: boolean; logLevel: string };
  update: { autoCheck: boolean; channel: 'stable' | 'beta'; checkIntervalHours: number };
  agent: { defaultModel: string; maxTokens: number; maxTurns: number; workingDirectory: string };
  tools: Record<string, { enabled: boolean; requireConfirmation?: boolean; timeout?: number }>;
  mcpServers: Record<string, unknown>;
  security: { authToken: string; bindLocalhostOnly: boolean };
  /** 统一权限决策配置（safety 模块；可选，旧 config 无此段时用默认值） */
  safety?: SafetyConfig;
}

/** 权限规则表（与后端 config.safety.rules 对齐） */
export interface SafetyRules {
  allow: string[];
  deny: string[];
  ask: string[];
}

/** config.safety 段（与后端 Zod schema 对齐） */
export interface SafetyConfig {
  defaultMode: PermissionMode;
  confirmTimeoutMinutes: number;
  blockDangerousCommands: boolean;
  cautionPolicy: 'ask' | 'deny';
  rules: SafetyRules;
  protectedPaths: string[];
}

export type ThinkingEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ModelConfig {
  /** 内部唯一 id（如 "model_1734..."） */
  id: string;
  /** 显示名，如 "GPT-4o" */
  name: string;
  /** 发送给 API 的模型名，如 "gpt-4o" */
  model: string;
  format: 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini';
  endpoint: string;
  apiKey: string;
  thinking: { enabled: boolean; effort?: ThinkingEffort; budgetTokens?: number };
  /** 上下文窗口档位，如 '200k' / '400k' / '1m'；可选 */
  contextWindow?: string;
}

export interface ApiConfig {
  version: number;
  models: ModelConfig[];
}

// ============================================================================
// MCP 类型（迁移）
// ============================================================================

export interface McpServer {
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  toolCount: number;
  /** 服务器定义（stdio=command+args+env；http/sse=url+headers） */
  transport?: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** 启停（config.mcpServers[name].enabled，缺省 true） */
  enabled?: boolean;
  /** 最近一次错误信息（status=error 时） */
  lastError?: string;
}

export interface McpTool {
  server: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
  /** MCP 工具注解（readOnlyHint/destructiveHint 等，驱动确认与展示） */
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

// ============================================================================
// 任务 / Todo / 上下文（见文档 3.2.1 / 3.2.9 / 3.2.10）
// ============================================================================

export interface TaskItem {
  id: string;
  title: string;
  groupId: string;
  createdAt: string;
  updatedAt: string;
  active?: boolean;
  /** 关联的 sessionId（task.id 即 sessionId，简化模型） */
  sessionId?: string;
  /** 分组内排序权重（小→前）；缺失视为最后 */
  order?: number;
}

export interface TaskGroup {
  id: string;
  name: string;
  expanded?: boolean;
  taskCount?: number;
}

export interface TodoItem {
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: 'low' | 'medium' | 'high';
  sessionId?: string;
}

export interface ContextFile {
  path: string;
  tokens?: number;
  reason?: 'read' | 'edit' | 'write' | 'grep' | 'glob';
}

// ============================================================================
// 模型管理（见文档 3.2.2）
// ============================================================================

export interface ModelItem {
  /** 内部唯一 id（如 "model_1734..."） */
  id: string;
  /** 显示名，如 "GPT-4o" */
  name: string;
  /** 发送给 API 的模型名，如 "gpt-4o" */
  model: string;
  format: 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini';
  endpoint: string;
  apiKey: string;
  /** 上下文窗口档位，如 '200k' / '400k' / '1m'；可选 */
  contextWindow?: string;
  thinking: {
    enabled: boolean;
    effort?: ThinkingEffort;
    budgetTokens?: number;
  };
}

// ============================================================================
// Agent 管理（见文档 3.2.3）
// ============================================================================

export interface AgentItem {
  id: string;
  name: string;
  description?: string;
  /** 图标标识（前端映射 LucideIcon） */
  icon?: string;
  builtIn: boolean;
  default?: boolean;
}

export interface AgentDetail extends AgentItem {
  systemPrompt?: string;
  model?: string;
  /** 启用的工具白名单 */
  tools?: string[];
  maxTurns?: number;
  maxTokens?: number;
}

// ============================================================================
// 工具（GET /api/tools，PATCH /api/tools/:name）
// ============================================================================

export interface ToolItem {
  name: string;
  description: string;
  icon?: string;
  /** 来源：内置或用户自定义 */
  source: 'builtin' | 'custom';
  /** 是否启用（从 config.tools[name].enabled 读取） */
  enabled: boolean;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    requireConfirmation?: boolean;
  };
  /** 工具来源目录绝对路径（热重载定位用） */
  sourceDir?: string;
}

// ============================================================================
// Skills / Specs 查询（见文档 3.2.5 / 3.2.6）
// ============================================================================

export interface SkillItem {
  name: string;
  description: string;
  source: 'user';
  /** 启停（config.skills[name].enabled，缺省 true） */
  enabled?: boolean;
  /** Lucide 图标名（kebab-case） */
  icon?: string;
  /** 切入模式欢迎语 */
  greet?: string;
  /** 目录式 skill 的附属文件清单（references/scripts/assets 相对路径） */
  files?: string[];
  /** 目录式 skill 根目录 */
  dir?: string;
}

export interface SkillDetail extends SkillItem {
  prompt: string;
  sourceFile?: string;
  /** 自定义 svg 图标内容（icon 以 .svg 结尾时后端返回） */
  iconSvg?: string;
}

export interface SpecItem {
  /** 相对路径，如 "coding" / "spec/coding" */
  id: string;
  description: string;
  source: 'builtin' | 'user';
}

export interface SpecDetail extends SpecItem {
  content: string;
  sourceFile?: string;
  /** 是否可通过 PUT /api/specs 编辑（仅用户目录内的 spec） */
  editable?: boolean;
}

// ============================================================================
// 自动化任务（见文档 3.2.7）
// ============================================================================

export interface AutomationItem {
  id: string;
  title: string;
  description?: string;
  /** 5 字段 cron 表达式 */
  cron: string;
  /** 触发时发送给 agent 的消息 */
  prompt: string;
  agentId?: string;
  enabled: boolean;
  paused: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
}

export interface AutomationDetail extends AutomationItem {
  history?: AutomationRun[];
}

export interface AutomationRun {
  id: string;
  automationId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'success' | 'failed' | 'timeout';
  finishReason?: string;
  finalText?: string;
  error?: string;
}

export interface AutomationTemplate {
  id: string;
  title: string;
  description: string;
  iconGradient?: string;
  /** 建议的 cron */
  cron?: string;
  /** 含 {{占位符}} 的 prompt 模板 */
  promptTemplate?: string;
}

// ============================================================================
// WebSocket 消息类型（迁移 + 新增）
// ============================================================================

export interface WSMessage {
  type: string;
  sessionId?: string;
  taskId?: string;
  payload?: unknown;
}

/** 单次运行（run）级统计（与后端 contracts RunStats 对齐；每次发送消息后重置） */
export interface RunStats {
  runId?: string;
  turns: number;
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
  | { type: 'ask'; sessionId: string; toolCallId: string; question: string; answerType?: PendingAsk['answerType']; options?: AskOption[]; defaultAnswer?: string; formSchema?: Record<string, unknown>; runId?: string }
  | { type: 'ask-timeout'; sessionId: string; toolCallId: string; runId?: string }
  | { type: 'confirm-required'; sessionId: string; toolCallId: string; toolName: string; question: string; details?: unknown; runId?: string }
  | { type: 'skill-mode'; sessionId: string; action: 'enter' | 'switch' | 'exit' | 'error'; name?: string; greet?: string; icon?: string; message?: string; runId?: string }
  | { type: 'stats-updated'; sessionId: string; stats: RunStats; runId?: string }
  | { type: 'error'; sessionId: string; message: string; runId?: string }
  | { type: 'done'; sessionId: string; finishReason: string; runId?: string };

/** ask 工具候选项 */
export interface AskOption {
  value: string;
  label: string;
}

/** ask 工具用户回答（结构化） */
export interface AskAnswer {
  selectedValues?: string[];
  selectedLabels?: string[];
  editedLabels?: Record<string, string>;
  otherText?: string;
  text?: string;
  /** form 模式（elicitation）：字段名 → 值 */
  form?: Record<string, string | number | boolean>;
}

/** ask 工具结局 */
export interface AskOutcome {
  action: 'accept' | 'cancel';
  answer?: AskAnswer;
}

/** 工具发起的、待用户回复的提问 */
export interface PendingAsk {
  toolCallId: string;
  sessionId: string;
  question: string;
  /** 回答类型：text（缺省）/single/multi/boolean/form（elicitation） */
  answerType?: 'text' | 'single' | 'multi' | 'boolean' | 'form';
  /** single/multi 类型的候选项 */
  options?: AskOption[];
  /** text 类型预填文本 */
  defaultAnswer?: string;
  /** form 类型：JSON Schema（elicitation requestedSchema） */
  formSchema?: Record<string, unknown>;
  /** 收到时间，用于排序 */
  createdAt: number;
}

/** 工具发起的、待用户确认的请求（requireConfirmation 工具执行前触发） */
export interface PendingConfirm {
  toolCallId: string;
  sessionId: string;
  /** 发起确认的工具名（如 shell/write/delete/undo） */
  toolName: string;
  /** 确认提示文案 */
  question: string;
  /** 工具调用参数（供前端展示具体将执行什么） */
  details?: unknown;
  /** 「始终允许」规则建议（safety 模块生成，如 "shell(git commit *)"；卡片展示+remember 回复） */
  ruleSuggestion?: string;
  /** 收到时间，用于排序 */
  createdAt: number;
}

// ============================================================================
// 文件系统（浏览器端文件夹选择：后端桥接绝对路径解析）
// ============================================================================

/** 搜索命中的候选目录 */
export interface DirectoryCandidate {
  /** 绝对路径 */
  path: string;
  /** 父目录绝对路径 */
  parent: string;
}

/** resolve-directory 返回结构 */
export interface ResolveDirectoryResult {
  candidates: DirectoryCandidate[];
  /** 唯一命中时的绝对路径，否则为 null */
  exactMatch: string | null;
}

/** suggest-paths 单项 */
export interface SuggestPath {
  path: string;
  label: string;
}

// ============================================================================
// 执行权限模式
// ============================================================================

/** 任务执行权限模式（对齐 PermissionModeSelector 现有 UI：3 种；与后端 safety/types 对齐） */
export type PermissionMode = 'ask' | 'auto' | 'skip';
