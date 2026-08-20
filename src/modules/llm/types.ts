// src/modules/llm/types.ts
// LLM 统一 canonical 类型 + 思考控制。
// 所有 provider 适配器把原生格式转换为/自这个统一格式。

// ============================================================================
// 思考控制
// ============================================================================

export type ThinkingEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ThinkingConfig {
  enabled: boolean;
  /** 思考强度：预设枚举值或自定义字符串（直接透传给 provider） */
  effort?: string;
  /** 自定义等级显示名 */
  label?: string;
  /** 思考 token 预算（仅 Anthropic budget_tokens / Gemini thinkingBudget 使用） */
  budgetTokens?: number;
}

// ============================================================================
// 统一请求/响应
// ============================================================================

export interface UnifiedTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: unknown; // JSONSchema
  };
}

export interface UnifiedToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON 字符串
  };
}

export type UnifiedMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface UnifiedMessage {
  role: UnifiedMessageRole;
  content: string;
  /** 工具调用 ID（role=tool 时必填） */
  toolCallId?: string;
  /** 助手消息的工具调用列表 */
  toolCalls?: UnifiedToolCall[];
  /** 名字（部分 provider 用 name 字段区分工具来源） */
  name?: string;
}

export interface UnifiedRequest {
  model: string;
  messages: UnifiedMessage[];
  tools?: UnifiedTool[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  /** Top K（仅 Anthropic top_k / Gemini topK 支持；OpenAI 忽略） */
  top_k?: number;
  stream: boolean;
  thinking?: ThinkingConfig;
  /** 强制使用工具 */
  toolChoice?: 'auto' | 'none' | 'required';
}

export interface UnifiedUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  reasoning_tokens?: number;
  /** 命中缓存的输入 token 数（prompt_tokens 含此部分；Anthropic 归一化后同样成立） */
  cached_tokens?: number;
}

export interface UnifiedResponse {
  content: string;
  thinking?: string;
  tool_calls?: UnifiedToolCall[];
  finish_reason: 'stop' | 'tool_use' | 'length' | 'error';
  usage: UnifiedUsage;
  /** 原始响应（调试用） */
  raw?: unknown;
}

// ============================================================================
// 流式增量
// ============================================================================

export type StreamDelta =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; toolCallId: string; name: string; argumentsDelta: string; index: number }
  | { type: 'usage'; usage: UnifiedUsage }
  | { type: 'finish'; finishReason: 'stop' | 'tool_use' | 'length' | 'error' }
  | { type: 'error'; message: string };

// ============================================================================
// Provider 适配器接口
// ============================================================================

export type ProviderFormat = 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini';

export interface ModelConfig {
  format: ProviderFormat;
  endpoint: string;
  apiKey: string;
  model: string;
  thinking: ThinkingConfig;
  /** 输入窗口 token 数（context 引擎压缩预算；provider 不直接使用） */
  inputTokens?: number;
  /** 输出窗口 token 数（请求 max_tokens 默认值） */
  outputTokens?: number;
  /** 模型温度 0-2 */
  temperature?: number;
  /** Top P 0-1 */
  topP?: number;
  /** Top K 0-100；0 表示不发送 */
  topK?: number;
}

export interface LLMProvider {
  readonly format: ProviderFormat;
  /** 将统一请求转换为原生请求体 */
  transformRequest(req: UnifiedRequest, cfg: ModelConfig): unknown;
  /** 将原生响应转换为统一响应 */
  transformResponse(raw: unknown): UnifiedResponse;
  /** 将单个 SSE chunk 转换为 StreamDelta（流式专用） */
  transformStreamChunk(raw: string): StreamDelta | StreamDelta[] | null;
  /** 解析 endpoint URL（拼接 model 等） */
  resolveEndpoint(cfg: ModelConfig): string;
  /** 构造鉴权头 */
  resolveHeaders(cfg: ModelConfig): Record<string, string>;
  /** 是否支持流式（默认 true） */
  supportsStream?: boolean;
}

// ============================================================================
// LLM 错误类型
// ============================================================================

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable?: boolean,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}
