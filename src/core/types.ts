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
  /** MOSS-OS 用户数据目录：~/.moss */
  readonly dataDir: string;
  /** MOSS-OS 配置目录：~/.moss/config */
  readonly configDir: string;
  /** MOSS-OS 日志目录：~/.moss/logs */
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
  register<T>(
    name: string,
    service: T,
    options?: {
      override?: boolean;
      scope?: string;
      /** 注册者类型：module 放行，plugin 受 ProtectedServiceNames 约束 */
      registrantType?: 'module' | 'plugin';
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

/**
 * 受保护服务注册表接口（PluginContext.services 的类型）。
 * 插件通过此视图访问服务：仅可消费 consumeServices 白名单内的服务，
 * 注册时受 ProtectedServiceNames 约束。
 */
export interface ProtectedServiceRegistry {
  tryResolve<T>(name: string): T | null;
  resolve<T>(name: string): T;
  has(name: string): boolean;
  list(): string[];
  /** 插件注册：受保护服务名会被拒绝 */
  register<T>(
    name: string,
    service: T,
    options?: { override?: boolean; scope?: string; registrantType?: 'plugin' },
  ): void;
  unregister(name: string): void;
}

// ============================================================================
// 配置服务
// ============================================================================

// type-only import：编译时擦除，无运行时循环依赖
// ToolsConfig 从 manifest 的 Zod schema 推导，保持类型与 schema 永远一致
import type { ToolsConfig } from '../modules/tools/manifest';

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
  // tools 类型从 manifest 自动推导（单一真相源），新增工具无需手动改此文件
  tools: ToolsConfig;
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
// 扩展系统（模组 Module + 插件 Plugin）
// ============================================================================
// 模组：权限仅次于内核，先加载，可注册受保护服务。
// 插件：权限较低，后加载，不可注册受保护服务，只能消费声明过的服务。
// 清单文件（module.json / plugin.json）替代原 metadata 字段。

export type ExtensionType = 'module' | 'plugin';

export type ExtensionState =
  | 'loaded'
  | 'initializing'
  | 'active'
  | 'destroying'
  | 'shutdown'
  | 'error';

/** 扩展基础清单字段（来自 module.json / plugin.json） */
export interface ExtensionManifest {
  /** 唯一标识（kebab-case） */
  name: string;
  version: string;
  description?: string;
  /** 扩展类型，由清单文件名隐式决定，此处用于运行时校验 */
  type: ExtensionType;
  /** 依赖的其他扩展：名称 -> 版本范围 */
  dependencies?: Record<string, string>;
  /** 权限声明（主要对插件生效；模组隐式拥有全部权限） */
  permissions?: {
    /** 需要注册的服务名（插件受 ProtectedServiceNames 约束） */
    registerServices?: string[];
    /** 需要消费的服务名白名单 */
    consumeServices?: string[];
  };
}

/** 模组清单（module.json 解析结果） */
export interface ModuleManifest extends ExtensionManifest {
  type: 'module';
}

/** 插件清单（plugin.json 解析结果） */
export interface PluginManifest extends ExtensionManifest {
  type: 'plugin';
}

/** 模组上下文：完整能力 */
export interface ModuleContext {
  logger: Logger;
  config: ConfigService;
  eventBus: EventBus;
  services: ServiceRegistry;
  env: Environment;
}

/** 插件上下文：受限能力（services 为 ProtectedServiceRegistry） */
export interface PluginContext {
  logger: Logger;
  config: ConfigService;
  eventBus: EventBus;
  services: ProtectedServiceRegistry;
  env: Environment;
}

/** 模组主接口（高权限） */
export interface Module {
  manifest: ModuleManifest;
  initialize(context: ModuleContext): Promise<void>;
  destroy?(): Promise<void>;
}

/** 插件主接口（低权限） */
export interface Plugin {
  manifest: PluginManifest;
  initialize(context: PluginContext): Promise<void>;
  destroy?(): Promise<void>;
}

/** 沿用旧名：扩展状态（与原 PluginState 等价） */
export type PluginState = ExtensionState;

/** 内核导出的统一上下文（供 CLI / 外部代码使用） */
export interface KernelContext {
  logger: Logger;
  config: ConfigService;
  eventBus: EventBus;
  services: ServiceRegistry;
  env: Environment;
  kernel: {
    stop(): Promise<void>;
    /** 返回所有扩展状态（modules + plugins） */
    getExtensionStates(): { modules: Record<string, ExtensionState>; plugins: Record<string, ExtensionState> };
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
// 标准服务名（由各模组注册）
// ============================================================================

export const ServiceNames = {
  LLM_ROUTER: 'llm.router',
  TOOL_REGISTRY: 'tool.registry',
  MCP_MANAGER: 'mcp.manager',
  AGENT_ENGINE: 'agent.engine',
  SERVER_INSTANCE: 'server.instance',
  /** Skill 注册表（由 tools 模组注册） */
  SKILL_REGISTRY: 'skill.registry',
  /** Spec 注册表（由 tools 模组注册） */
  SPEC_REGISTRY: 'spec.registry',
} as const;

/**
 * 受保护的服务名集合：仅模组可注册，插件不可注册。
 * = ServiceNames 全部值。
 */
export const ProtectedServiceNames: ReadonlySet<string> = new Set<string>(
  Object.values(ServiceNames),
);
