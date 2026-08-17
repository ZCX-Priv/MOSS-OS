// src/modules/tools/types.ts
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
  /** 显示图标（lucide 图标 kebab-case 名，如 'file-text'；前端白名单映射，缺失回退扳手） */
  icon?: string;
  execute(params: unknown, ctx: ToolContext): Promise<ToolResult>;
  /** 工具来源目录绝对路径（热重载增量定位用，由加载器注入） */
  sourceDir?: string;
  /** 工具来源类型（builtin=内置，custom=用户自定义，由加载器注入） */
  source?: 'builtin' | 'custom';
}

/** ask 工具候选项 */
export interface AskOption {
  /** 选项标识（LLM 生成，如 "a"/"postgres"） */
  value: string;
  /** 选项显示文本 */
  label: string;
}

/** ask 工具提问载荷 */
export interface AskPayload {
  question: string;
  /** 回答类型：text=自由文本（缺省）、single=单选、multi=多选、boolean=是/否、form=动态表单 */
  answerType?: 'text' | 'single' | 'multi' | 'boolean' | 'form';
  /** answerType 为 single/multi 时的候选项（2-6 个） */
  options?: AskOption[];
  /** 预填文本（可选） */
  defaultAnswer?: string;
  /** answerType=form 时的 JSON Schema（MCP elicitation Form 模式：string/number/boolean/enum） */
  formSchema?: Record<string, unknown>;
}

/** ask 工具用户回答结果 */
export interface AskAnswer {
  /** 选中的选项 value 列表（single 为 0/1 个，multi 为 0-N 个） */
  selectedValues?: string[];
  /** 选中的选项显示文本列表（含用户编辑后的文本） */
  selectedLabels?: string[];
  /** 用户编辑过的选项：value → 编辑后的 label */
  editedLabels?: Record<string, string>;
  /** 「其他」自由输入文本 */
  otherText?: string;
  /** text 类型的自由回答文本 */
  text?: string;
  /** form 类型的表单回答（字段名 → 值；MCP elicitation） */
  form?: Record<string, string | number | boolean>;
}

/** ask 工具结局：accept=用户已回答，cancel=用户取消提问 */
export interface AskOutcome {
  action: 'accept' | 'cancel';
  answer?: AskAnswer;
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
  askUser?: (payload: AskPayload) => Promise<AskOutcome>;
  /** 请求用户确认（返回 boolean）。requireConfirmation 工具执行前会调用；未提供且需确认时保守拒绝。 */
  confirm?: (question: string) => Promise<boolean>;
  /** 当前工具的配置（从 config.tools[name] 读取，供工具消费如 timeout/requireConfirmation） */
  toolConfig?: Record<string, unknown>;
  /** safety 模块已放行标记：agent 链路决策 allow 后置 'allowed'，registry 据此跳过内部 requireConfirmation（非 agent 链路仍走兜底确认） */
  permissionDecision?: 'allowed';
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
