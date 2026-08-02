// frontend/src/types/index.ts
// 前端共享类型定义

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; source: { data: string; mimeType: string } }>;
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

export interface AppConfig {
  version: number;
  server: { host: string; port: number; autoPort: boolean };
  daemon: { enabled: boolean; logLevel: string };
  update: { autoCheck: boolean; channel: 'stable' | 'beta'; checkIntervalHours: number };
  agent: { defaultModel: string; maxTokens: number; maxTurns: number; workingDirectory: string };
  tools: {
    read: { enabled: boolean };
    write: { enabled: boolean; requireConfirmation: boolean };
    edit: { enabled: boolean; requireConfirmation: boolean };
    shell: { enabled: boolean; timeout: number; requireConfirmation: boolean };
    use_skill: { enabled: boolean };
    use_mcp: { enabled: boolean };
    list_mcp: { enabled: boolean };
  };
  mcpServers: Record<string, unknown>;
  security: { authToken: string; bindLocalhostOnly: boolean };
}

export type ThinkingEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ProviderConfig {
  format: 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini';
  endpoint: string;
  apiKey: string;
  models: string[];
  thinking: {
    enabled: boolean;
    effort?: ThinkingEffort;
    budgetTokens?: number;
  };
}

export interface ApiConfig {
  version: number;
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;
}

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
// WebSocket 消息类型
// ============================================================================

export interface WSMessage {
  type: string;
  sessionId?: string;
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
