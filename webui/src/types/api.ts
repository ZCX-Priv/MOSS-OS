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
}

export interface ToolResult {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; source: { data: string; mimeType: string } }
  >;
  isError?: boolean;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  toolResults?: Array<{ toolCallId: string; result: ToolResult }>;
  timestamp: string;
  /** 是否正在流式生成 */
  streaming?: boolean;
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
  server: { host: string; port: number; autoPort: boolean };
  daemon: { enabled: boolean; logLevel: string };
  update: { autoCheck: boolean; channel: 'stable' | 'beta'; checkIntervalHours: number };
  agent: { defaultModel: string; maxTokens: number; maxTurns: number; workingDirectory: string };
  tools: Record<string, { enabled: boolean; requireConfirmation?: boolean; timeout?: number }>;
  mcpServers: Record<string, unknown>;
  security: { authToken: string; bindLocalhostOnly: boolean };
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
}

export interface McpTool {
  server: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
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
// 插件管理（见文档 3.2.4）
// ============================================================================

export interface PluginItem {
  id: string;
  name: string;
  description: string;
  /** 前端展示用渐变色（可由后端配置或前端硬编码） */
  iconGradient?: string;
  enabled: boolean;
  builtIn: boolean;
  type: 'module' | 'plugin';
  version?: string;
}

// ============================================================================
// Skills / Specs 查询（见文档 3.2.5 / 3.2.6）
// ============================================================================

export interface SkillItem {
  name: string;
  description: string;
  source: 'builtin' | 'user';
}

export interface SkillDetail extends SkillItem {
  prompt: string;
  sourceFile?: string;
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
// 扩展状态（见文档 3.2.8）
// ============================================================================

export interface ExtensionState {
  name: string;
  version: string;
  description?: string;
  type: 'module' | 'plugin';
  state: 'loaded' | 'initializing' | 'active' | 'destroying' | 'shutdown' | 'error';
  enabled: boolean;
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

export type AgentEvent =
  | { type: 'assistant-text'; sessionId: string; text: string }
  | { type: 'assistant-thinking'; sessionId: string; text: string }
  | { type: 'tool-call-start'; sessionId: string; toolName: string; toolCallId: string; args: unknown }
  | { type: 'tool-call-end'; sessionId: string; toolName: string; toolCallId: string; result: ToolResult }
  | { type: 'ask'; sessionId: string; toolCallId: string; question: string }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'done'; sessionId: string; finishReason: string };

/** 工具发起的、待用户回复的提问 */
export interface PendingAsk {
  toolCallId: string;
  sessionId: string;
  question: string;
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
