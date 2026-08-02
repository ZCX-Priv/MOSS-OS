// src/plugins/tools/types.ts
// 工具系统类型定义。

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  /** 是否需要用户确认 */
  requireConfirmation?: boolean;
}

/** JSONSchema 简化表示 */
export interface JSONSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  oneOf?: JSONSchema[];
  anyOf?: JSONSchema[];
  additionalProperties?: boolean | JSONSchema;
  [key: string]: unknown;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  annotations?: ToolAnnotations;
  execute(params: unknown, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  sessionId: string;
  cwd: string;
  /** 工具调用 ID */
  toolCallId: string;
  /** 通过事件总线发送进度事件 */
  emit: (event: ToolEvent) => void;
  logger: import('../../core/types').Logger;
  /** 服务注册表（用于访问 MCPManager、SkillRegistry 等服务） */
  services: import('../../core/types').ServiceRegistry;
  /** 中断信号 */
  signal?: AbortSignal;
  /** 向用户提问并阻塞等待回复（若运行环境不支持交互则 undefined） */
  askUser?: (question: string) => Promise<string>;
  /** 当前工具的配置（从 config.tools[name] 读取，供工具消费如 timeout/requireConfirmation） */
  toolConfig?: Record<string, unknown>;
}

export type ToolEvent =
  | { type: 'progress'; message: string }
  | { type: 'confirm-required'; message: string; details?: unknown };

export type ToolResultContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { data: string; mimeType: string } };

export interface ToolResult {
  content: ToolResultContent[];
  isError?: boolean;
  /** 工具执行的元信息（如耗时、退出码） */
  metadata?: Record<string, unknown>;
}

/** 帮助函数：构造文本结果 */
export function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError };
}

/** 帮助函数：构造错误结果 */
export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}
