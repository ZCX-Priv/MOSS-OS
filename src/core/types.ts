// src/core/types.ts
// 微内核类型契约：所有内核服务的接口定义。
// 内核只定义契约，不包含业务逻辑。

// ============================================================================
// 日志服务
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  fatal(message: string, context?: Record<string, unknown>): void;
  /** 创建子日志器，自动附加前缀 */
  child(scope: string): Logger;
  /** 动态调整级别 */
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
}

// ============================================================================
// 环境检测
// ============================================================================

export type Platform = 'win32' | 'darwin' | 'linux' | 'other';

export interface Environment {
  readonly platform: Platform;
  readonly arch: string;
  readonly isWindows: boolean;
  readonly isMac: boolean;
  readonly isLinux: boolean;
  /** 用户主目录 */
  readonly homeDir: string;
  /** MOSS 用户数据目录：~/.moss */
  readonly dataDir: string;
  /** MOSS 配置目录：~/.moss/config */
  readonly configDir: string;
  /** MOSS 日志目录：~/.moss/logs */
  readonly logsDir: string;
  /** PID 文件路径：~/.moss/moss.pid */
  readonly pidFile: string;
  /** 运行时 Bun 版本 */
  readonly runtimeVersion: string;
  /** 当前进程 PID */
  readonly pid: number;
  /** 包安装根目录 */
  readonly packageRoot: string;
}

// ============================================================================
// 事件总线（Hook 系统）
// ============================================================================

/**
 * Filter 模式 handler：接收数据，可修改并返回。
 * 用于请求/响应处理链（如 llm:request:before）。
 */
export type FilterHandler<T> = (data: T) => T | Promise<T>;

/**
 * Action 模式 handler：执行副作用，不返回数据。
 * 用于通知/日志（如 session:message）。
 */
export type ActionHandler = (data: unknown) => void | Promise<void>;

export interface EventBusSubscription {
  /** 注销此订阅 */
  unsubscribe(): void;
}

export interface EventBus {
  /**
   * 注册 Filter handler。emit 时按 priority 升序执行（priority 小的先执行）。
   * 同 priority 按 注册顺序。
   */
  on<T>(event: string, handler: FilterHandler<T>, priority?: number): EventBusSubscription;

  /**
   * 注册 Action handler。broadcast 时并行调用所有 handler。
   */
  onAction(event: string, handler: ActionHandler): EventBusSubscription;

  /**
   * 触发 Filter 事件：链式调用所有 handler，返回最终数据。
   * 任一 handler 抛错则中断链，错误向上抛。
   */
  emit<T>(event: string, data: T): Promise<T>;

  /**
   * 广播 Action 事件：并行调用所有 handler。
   * 单个 handler 抛错不影响其他 handler，仅记录日志。
   */
  broadcast(event: string, data: unknown): Promise<void>;

  /** 移除指定 handler */
  off(event: string, handler: Function): void;

  /** 注销某个 scope 注册的所有 handler（模块销毁时调用） */
  offAll(scope: string): void;

  /** 列出所有已注册事件名（调试用） */
  listEvents(): string[];
}

// ============================================================================
// 服务注册表
// ============================================================================

export interface ServiceRegistry {
  /** 注册服务。若已存在同名服务且未强制覆盖则抛错。 */
  register<T>(
    name: string,
    service: T,
    options?: {
      override?: boolean;
      scope?: string;
    },
  ): void;
  /** 解析服务，不存在则抛错 */
  resolve<T>(name: string): T;
  /** 尝试解析，不存在返回 null */
  tryResolve<T>(name: string): T | null;
  has(name: string): boolean;
  /** 注销服务（仅限注册 scope 自己） */
  unregister(name: string): void;
  /** 注销某个 scope 注册的所有服务 */
  unregisterScope(scope: string): void;
  /** 列出所有已注册服务名 */
  list(): string[];
}

// ============================================================================
// 配置服务
// ============================================================================

// type-only import：编译时擦除，无运行时循环依赖
// ToolsConfig 从 manifest 的 Zod schema 推导，保持类型与 schema 永远一致
import type { ToolsConfig } from '../modules/tools/manifest';
import type { FileHistoryConfig } from '../modules/file-history/types';
import type { FilesysConfig } from '../modules/filesys/types';

/** 应用配置（config.json）的结构 —— 由 config-service 中 Zod schema 严格校验 */
export interface AppConfig {
  version: number;
  server: {
    host: string;
    port: number;
    autoPort: boolean;
    locale?: string;
  };
  daemon: {
    enabled: boolean;
    logLevel: LogLevel;
  };
  update: {
    autoCheck: boolean;
    channel: 'stable' | 'beta';
    checkIntervalHours: number;
  };
  agent: {
    defaultModel: string;
    maxTokens: number;
    maxTurns: number;
    workingDirectory: string;
  };
  // tools 类型从 manifest 自动推导（单一真相源），新增工具无需手动改此文件
  tools: ToolsConfig;
  mcpServers: Record<string, unknown>;
  /** MCP 客户端配置（调用超时 / sampling 授权） */
  mcp?: {
    /** 单次 MCP 工具调用超时（毫秒），默认 120000 */
    callTimeoutMs?: number;
    /** 是否允许 MCP 服务器借用本地 LLM（sampling），默认 true */
    allowSampling?: boolean;
  };
  /** 对外 MCP Server 暴露配置（/mcp 端点） */
  mcpServer?: {
    /** 是否启用对外暴露，默认 false */
    enabled: boolean;
    /** 暴露的工具白名单；空数组 = 全部内置工具（requireConfirmation 工具除外） */
    allowedTools: string[];
  };
  /** Skill 启停（name → { enabled }，缺省视为启用） */
  skills?: Record<string, { enabled?: boolean }>;
  security: {
    authToken: string;
    bindLocalhostOnly: boolean;
  };
  /** 文件历史服务配置（由 file-history 模块消费） */
  fileHistory?: FileHistoryConfig;
  /** 虚拟文件系统配置（由 filesys 模块消费：roots/缓存/shell 快照检测） */
  filesys?: FilesysConfig;
}

export type ApiConfig = {
  version: number;
  models: ModelConfig[];
};

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
  thinking: {
    enabled: boolean;
    effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    budgetTokens?: number;
  };
  /** 上下文窗口档位，如 '200k' / '400k' / '1m'；可选 */
  contextWindow?: string;
}

export interface ConfigService {
  /** 加载配置（首次运行自动从模板复制） */
  load(): Promise<void>;
  /** 配置加载失败时回退到默认配置（降级运行，仅内存） */
  loadDefaults(): void;
  /** 获取当前应用配置（只读视图） */
  getAppConfig(): AppConfig;
  /** 获取当前 API 配置（只读视图） */
  getApiConfig(): ApiConfig;
  /** 更新应用配置（持久化） */
  updateAppConfig(patch: Partial<AppConfig>): Promise<void>;
  /** 更新 API 配置（持久化） */
  updateApiConfig(patch: Partial<ApiConfig>): Promise<void>;
  /** 重新从磁盘加载 */
  reload(): Promise<void>;
  /** 监听配置变更 */
  onChange(handler: (which: 'app' | 'api') => void): EventBusSubscription;
}

// ============================================================================
// 模块系统
// ============================================================================
// 模块由内核静态 import 直接编排：按固定顺序初始化、反向销毁。

/** 模块上下文：完整能力 */
export interface ModuleContext {
  logger: Logger;
  config: ConfigService;
  eventBus: EventBus;
  services: ServiceRegistry;
  env: Environment;
}

/** 模块主接口 */
export interface Module {
  initialize(context: ModuleContext): Promise<void>;
  destroy?(): Promise<void>;
}

/** 内核导出的统一上下文（供 CLI / 外部代码使用） */
export interface KernelContext {
  logger: Logger;
  config: ConfigService;
  eventBus: EventBus;
  services: ServiceRegistry;
  env: Environment;
  kernel: {
    stop(): Promise<void>;
  };
}

// ============================================================================
// 内核标准事件名
// ============================================================================

export const KernelEvents = {
  Ready: 'kernel:ready',
  Shutdown: 'kernel:shutdown',
  ConfigChanged: 'config:changed',
} as const;

// ============================================================================
// 标准服务名（由各模块注册）
// ============================================================================

export const ServiceNames = {
  LLM_ROUTER: 'llm.router',
  TOOL_REGISTRY: 'tool.registry',
  MCP_MANAGER: 'mcp.manager',
  AGENT_ENGINE: 'agent.engine',
  SERVER_INSTANCE: 'server.instance',
  /** Skill 注册表（由 tools 模块注册） */
  SKILL_REGISTRY: 'skill.registry',
  /** Spec 注册表（由 tools 模块注册） */
  SPEC_REGISTRY: 'spec.registry',
  /** Agent 注册表（由 agents 模块注册） */
  AGENTS_REGISTRY: 'agents.registry',
  /** 自动化任务服务（由 automation 模块注册） */
  AUTOMATION_SERVICE: 'automation.service',
  /** 文件历史服务（由 file-history 模块注册：Track Edit + Snapshot + undo） */
  FILE_HISTORY: 'file.history',
  /** 虚拟文件系统服务（由 filesys 模块注册：统一文件 IO / 读缓存 / roots / 变更事件） */
  FILESYS: 'file.sys',
} as const;
