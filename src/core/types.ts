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
  /** MOSS-OS 用户数据目录：~/.moss-os */
  readonly dataDir: string;
  /** MOSS-OS 配置目录：~/.moss-os/config */
  readonly configDir: string;
  /** MOSS-OS 日志目录：~/.moss-os/logs */
  readonly logsDir: string;
  /** PID 文件路径：~/.moss-os/moss.pid */
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

  /** 注销某个 scope 注册的所有 handler（插件卸载时调用） */
  offAll(scope: string): void;

  /** 列出所有已注册事件名（调试用） */
  listEvents(): string[];
}

// ============================================================================
// 服务注册表
// ============================================================================

export interface ServiceRegistry {
  /** 注册服务。若已存在同名服务且未强制覆盖则抛错。 */
  register<T>(name: string, service: T, options?: { override?: boolean; scope?: string }): void;
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

/** 应用配置（config.json）的结构 —— 由 config-service 中 Zod schema 严格校验 */
export interface AppConfig {
  version: number;
  server: {
    host: string;
    port: number;
    autoPort: boolean;
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
  security: {
    authToken: string;
    bindLocalhostOnly: boolean;
  };
}

export type ApiConfig = {
  version: number;
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;
};

export interface ProviderConfig {
  format: 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini';
  endpoint: string;
  apiKey: string;
  models: string[];
  thinking: {
    enabled: boolean;
    effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    budgetTokens?: number;
  };
}

export interface ConfigService {
  /** 加载配置（首次运行自动从模板复制） */
  load(): Promise<void>;
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
// 插件系统
// ============================================================================

export interface PluginMetadata {
  /** 唯一标识（kebab-case） */
  name: string;
  version: string;
  description?: string;
  /** 依赖的其他插件：插件名 -> 版本范围 */
  dependencies?: Record<string, string>;
}

/** 内核注入给插件的能力 */
export interface PluginContext {
  logger: Logger;
  config: ConfigService;
  eventBus: EventBus;
  services: ServiceRegistry;
  env: Environment;
}

export type PluginState =
  | 'loaded'
  | 'initializing'
  | 'active'
  | 'destroying'
  | 'shutdown'
  | 'error';

/** 插件主接口 */
export interface Plugin {
  metadata: PluginMetadata;
  initialize(context: PluginContext): Promise<void>;
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
    getPluginStates(): Record<string, PluginState>;
  };
}

// ============================================================================
// 内核标准事件名
// ============================================================================

export const KernelEvents = {
  Ready: 'kernel:ready',
  Shutdown: 'kernel:shutdown',
  PluginLoaded: 'plugin:loaded',
  PluginUnloaded: 'plugin:unloaded',
  PluginError: 'plugin:error',
  ConfigChanged: 'config:changed',
} as const;

// ============================================================================
// 标准服务名（由各插件注册）
// ============================================================================

export const ServiceNames = {
  LLM_ROUTER: 'llm.router',
  TOOL_REGISTRY: 'tool.registry',
  MCP_MANAGER: 'mcp.manager',
  AGENT_ENGINE: 'agent.engine',
  SERVER_INSTANCE: 'server.instance',
} as const;
