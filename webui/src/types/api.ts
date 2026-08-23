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
  /** 压缩卡片数据（上下文引擎压缩完成时插入消息流；驱动 CompactionCard 渲染） */
  compaction?: CompactionRecord;
  /** 轮数触顶提示卡数据（达到 agent.maxTurns 上限时插入；驱动 MaxTurnsNoticeCard 渲染 + 继续按钮） */
  maxTurnsNotice?: { maxTurns: number };
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
  daemon: { enabled: boolean };
  /** 日志系统配置（级别 / 保留天数 / 单文件大小上限） */
  logs: LogsConfig;
  update: { autoCheck: boolean; channel: 'stable' | 'beta'; checkIntervalHours: number };
  agent: { defaultModel: string; maxTokens: number; maxTurns: number; workingDirectory: string };
  tools: Record<string, { enabled: boolean; requireConfirmation?: boolean; timeout?: number }>;
  mcpServers: Record<string, unknown>;
  security: { authToken: string; bindLocalhostOnly: boolean };
  /** 统一权限决策配置（safety 模块；可选，旧 config 无此段时用默认值） */
  safety?: SafetyConfig;
  /** 上下文引擎配置（context 模块；可选，旧 config 无此段时用默认值） */
  context?: ContextEngineConfig;
}

/** 日志级别（与后端 LogLevel 对齐） */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** config.logs 段（与后端 Zod schema 对齐） */
export interface LogsConfig {
  level: LogLevel;
  retentionDays: number;
  maxFileMb: number;
}

/** 日志文件元信息（GET /api/logs/files） */
export interface LogFileInfo {
  name: string;
  size: number;
  mtime: number;
}

/** 日志行查询结果（GET /api/logs） */
export interface LogQueryResult {
  lines: string[];
  total: number;
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

// ============================================================================
// 上下文引擎类型（与后端 src/modules/context/types.ts 对齐）
// ============================================================================

/** config.context.compaction 段 */
export interface CompactionConfig {
  enabled: boolean;
  compactRatio: number;
  tailKeepRatio: number;
  summaryMaxTokens: number;
  minFoldTokens: number;
  /** 'inherit' = 主模型；否则为模型 id */
  summaryModel: string;
}

/** config.context.toolPruning 段 */
export interface ToolPruningConfig {
  enabled: boolean;
  thresholdChars: number;
  keepHeadChars: number;
  keepTailChars: number;
}

/** config.context.healer 段 */
export interface HealerConfig {
  enabled: boolean;
  toolNameFuzzy: boolean;
  schemaFix: boolean;
}

/** config.context 段 */
export interface ContextEngineConfig {
  compaction: CompactionConfig;
  toolPruning: ToolPruningConfig;
  healer: HealerConfig;
  telemetry: { enabled: boolean };
}

/** 压缩历史记录（session.compactions 元素 / GET /api/context/:id/compactions） */
export interface CompactionRecord {
  id: string;
  at: string;
  trigger: 'auto' | 'manual';
  beforeTokens: number;
  afterTokens: number;
  compactedCount: number;
  /** 物理折叠的消息条数（新实现 = compactedCount；旧记录仅标记未折叠时缺省） */
  foldedMessageCount?: number;
  summary: string;
  boundaryTimestamp?: string;
  summaryModel: string;
  durationMs: number;
}

/** token 构成分解 */
export interface ContextBreakdown {
  system: number;
  env: number;
  summary: number;
  history: number;
  total: number;
}

/** 缓存命中样本 */
export interface CacheHitSample {
  at: string;
  promptTokens: number;
  cachedTokens: number;
  hitRate: number;
}

/** 系统上下文分段（「系统」标签页折叠栏数据） */
export interface SystemSection {
  id: string;
  title: string;
  tokens: number;
  content: string;
  defaultOpen?: boolean;
}

/** GET /api/context/:sessionId/stats 响应 */
export interface ContextStats {
  sessionId: string;
  /** 当前会话模型（模型与配置摘要行数据源） */
  model: { id: string; name: string };
  breakdown: ContextBreakdown;
  windowTokens: number;
  usedPercent: number;
  /** 最近一次请求的真实 usage（LLM 上报；无样本为 null；实时指标栏数据源） */
  lastUsage: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
  } | null;
  compaction: {
    enabled: boolean;
    compactRatio: number;
    compactedMessages: number;
    activeSummaryTokens: number;
    lastCompaction?: CompactionRecord;
  };
  cacheHits: CacheHitSample[];
  avgHitRate: number | null;
  systemSections: SystemSection[];
}

/** GET /api/context/:sessionId/compact-preview 响应（确认框数据） */
export interface CompactPreview {
  sessionId: string;
  compactableCount: number;
  compactableTokens: number;
  tailKeepCount: number;
  estimatedAfterTokens: number;
}

/** POST /api/context/:sessionId/compact 响应 */
export interface ManualCompactResult {
  ok: boolean;
  compaction?: CompactionRecord;
  error?: string;
}

/** 模型 thinking 配置：effort 为预设档或自定义字符串 */
export interface ModelThinking {
  enabled: boolean;
  /** 思考强度：预设档（low/medium/high 等）或自定义值 */
  effort?: string;
  /** 自定义等级显示名（预设档无此字段） */
  label?: string;
  budgetTokens?: number;
}

export interface ApiConfig {
  version: number;
  providers: ProviderItem[];
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
  /** 分组来源：folder = 按工作目录自动创建（空时后端自动销毁）；manual = 手动新建（允许空状态） */
  source?: 'folder' | 'manual';
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
  reason?: 'read' | 'edit' | 'write' | 'grep' | 'glob' | 'delete' | 'move' | 'copy';
  /** 后端存在性校验标记：文件已被删除/移走（HTTP 恢复与 WS 推送时计算） */
  missing?: boolean;
}

// ============================================================================
// 模型管理（见文档 3.2.2）
// ============================================================================

/** 服务商思考强度等级（等级库条目；预设档 id 固定 off/low/medium/high） */
export interface ThinkingLevelItem {
  id: string;
  /** 显示名，如 "极致" / "关闭" */
  label: string;
  /** API 参数值：'off'/'low'/'medium'/'high'/自定义（如 'xhigh'） */
  effort: string;
}

/** 服务商附加服务（当前仅文件存储） */
export interface ProviderServiceItem {
  id: string;
  name: string;
  type: 'file-storage';
  endpoint: string;
  apiKey: string;
  /** 最大限额数值 */
  maxQuota?: number;
  /** 限额单位 */
  quotaUnit?: 'MB' | 'GB' | 'TB';
}

/** 服务商配置（与后端 ProviderConfig 对齐）：持有 API 格式/地址/Key 及自定义查询地址 */
export interface ProviderItem {
  /** 内部唯一 id（如 "provider_1734..."） */
  id: string;
  /** 显示名，如 "OpenAI" */
  name: string;
  format: 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini';
  endpoint: string;
  apiKey: string;
  /** 自定义余额查询地址（OpenAI 兼容 subscription 接口完整 URL；空 = 不提供余额查询） */
  balanceUrl?: string;
  /** 自定义模型列表获取地址（空 = 按 API 格式自动推断） */
  modelsUrl?: string;
  /** 品牌图标 key（@lobehub/icons 的 provider key；空 = 默认 Server 图标） */
  icon?: string;
  /** 思考强度等级库（服务商级，有序；undefined = 默认库 [off,low,medium,high]） */
  thinkingLevels?: ThinkingLevelItem[];
  /** 附加服务（文件存储等） */
  services?: ProviderServiceItem[];
  models: ProviderModelItem[];
}

/** 服务商下的模型：名称 + 模型 id + 模型级高级配置 */
export interface ProviderModelItem {
  /** 内部唯一 id（如 "model_1734..."） */
  id: string;
  /** 显示名，如 "GPT-4o" */
  name: string;
  /** 发送给 API 的模型名，如 "gpt-4o" */
  model: string;
  /** 上下文窗口档位（旧格式，如 '200k'）；读取时 inputTokens 优先 */
  contextWindow?: string;
  /** 输入窗口 token 数（context 引擎压缩预算） */
  inputTokens?: number;
  /** 输出窗口 token 数（请求 max_tokens 默认值） */
  outputTokens?: number;
  /** 模型温度 0-2 */
  temperature?: number;
  /** Top P 0-1 */
  topP?: number;
  /** Top K 0-100；0 表示不发送 */
  topK?: number;
  thinking: ModelThinking;
}

/** 远程模型列表项（POST /api/providers/:id/models/fetch 归一化结果） */
export interface RemoteModelItem {
  id: string;
  name?: string;
}

/** 余额查询结果（POST /api/providers/:id/balance） */
export interface ProviderBalanceResult {
  success: boolean;
  totalUsd?: number;
  usedUsd?: number;
  balanceUsd?: number;
  error?: string;
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
  /** lucide 图标名（kebab-case，如 'calendar-clock'；缺省回退首字母） */
  icon?: string;
  /** 调度类型：cron=周期循环；once=指定时间执行一次 */
  scheduleType: 'cron' | 'once';
  /** scheduleType='cron' 时的 5 字段 cron 表达式 */
  cron?: string;
  /** scheduleType='once' 时的执行时间（ISO 字符串） */
  runAt?: string;
  /** once 任务被调度器执行后标记 true（保留在列表，改 runAt 后重新启用） */
  completed?: boolean;
  /** 执行工作目录（绝对路径） */
  cwd: string;
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
  /** 本次运行创建的真实任务 id（点击跳转 /task/:taskId） */
  taskId?: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'success' | 'failed' | 'timeout';
  finishReason?: string;
  finalText?: string;
  error?: string;
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
  /** 本次 run 的轮数（每次 run 重置；X/N 进度显示用） */
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
