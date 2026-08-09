// src/core/kernel.ts
// Microkernel 主类：组装所有内核服务，编排模组/插件生命周期。
// 模组（modules）拥有高权限，先加载；插件（plugins）权限较低，后加载。

import { detectEnvironment } from './env';
import { createRootLogger } from './logger';
import { createEventBus } from './event-bus';
import { createServiceRegistry } from './service-registry';
import { createConfigService } from './config-service';
import { ExtensionManager, type ExtensionManagerOptions } from './extension-manager';
import type {
  KernelContext,
  Logger,
  EventBus,
  ServiceRegistry,
  ConfigService,
  Environment,
  ModuleContext,
  ExtensionState,
  LogLevel,
} from './types';

export interface KernelStartOptions {
  /** 前台运行（不 detach） */
  foreground?: boolean;
  /** 扩展管理器选项 */
  extensions?: ExtensionManagerOptions;
  /** 初始日志级别 */
  logLevel?: LogLevel;
}

export class Microkernel {
  private env: Environment | null = null;
  private logger: Logger | null = null;
  private eventBus: EventBus | null = null;
  private services: ServiceRegistry | null = null;
  private config: ConfigService | null = null;
  private extensionManager: ExtensionManager | null = null;
  private started = false;

  async start(options: KernelStartOptions = {}): Promise<KernelContext> {
    if (this.started) {
      throw new Error('Kernel already started');
    }

    // 1. 初始化内核服务
    this.env = detectEnvironment();
    this.logger = createRootLogger(this.env, options.logLevel ?? 'info');
    this.logger.info('MOSS kernel starting', {
      platform: this.env.platform,
      arch: this.env.arch,
      bunVersion: this.env.runtimeVersion,
      pid: this.env.pid,
      dataDir: this.env.dataDir,
    });

    this.eventBus = createEventBus(this.logger);
    this.services = createServiceRegistry(this.logger);

    // 2. 加载配置
    this.config = createConfigService(this.env, this.eventBus, this.logger);
    try {
      await this.config.load();
      // 应用配置中的日志级别
      const cfgLevel = this.config.getAppConfig().daemon.logLevel;
      this.logger.setLevel(cfgLevel);
      this.logger.info('Config loaded', { logLevel: cfgLevel });
    } catch (err) {
      this.logger.error('Failed to load config, falling back to defaults', {
        error: err instanceof Error ? err.message : String(err),
      });
      // 真正回退到默认配置，避免后续所有模块因 "Config not loaded" 连锁失败
      this.config.loadDefaults();
      const cfgLevel = this.config.getAppConfig().daemon.logLevel;
      this.logger.setLevel(cfgLevel);
    }

    // 3. 构建模组上下文（完整能力）
    const moduleCtx: ModuleContext = {
      logger: this.logger,
      config: this.config,
      eventBus: this.eventBus,
      services: this.services,
      env: this.env,
    };

    // 4. 发现并加载扩展（模组 + 插件）
    this.extensionManager = new ExtensionManager(moduleCtx, options.extensions ?? {});
    await this.extensionManager.discoverAndLoad();

    // 5. 按序初始化扩展
    await this.extensionManager.initializeAll();

    // 暴露扩展管理服务（供 extensions 路由使用）
    // 阶段5.4：enable/disable 后广播 extension:changed，由 server 模组订阅转发为 WS
    this.services.register(
      'kernel.extensions',
      {
        getStates: () => this.extensionManager!.getExtensionStates(),
        getActiveCount: () => this.extensionManager!.getActiveExtensionCount(),
        getList: () => this.extensionManager!.getExtensionList(),
        enable: (name: string) => {
          this.extensionManager!.enable(name);
          void this.eventBus!.broadcast('extension:changed', { name, action: 'enable' });
        },
        disable: (name: string) => {
          this.extensionManager!.disable(name);
          void this.eventBus!.broadcast('extension:changed', { name, action: 'disable' });
        },
        isDisabled: (name: string) => this.extensionManager!.isDisabled(name),
      },
      { scope: 'kernel', registrantType: 'module' },
    );

    this.started = true;
    await this.eventBus.broadcast('kernel:ready', { pid: this.env.pid });

    const activeCount = this.extensionManager.getActiveExtensionCount();
    this.logger.info('MOSS kernel ready', {
      activeExtensions: activeCount,
      services: this.services.list(),
    });

    return this.makeContext();
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.logger?.info('MOSS kernel stopping');
    await this.eventBus?.broadcast('kernel:shutdown', {});

    if (this.extensionManager) {
      await this.extensionManager.destroyAll();
    }
    this.started = false;
    this.logger?.info('MOSS kernel stopped');
  }

  isStarted(): boolean {
    return this.started;
  }

  private makeContext(): KernelContext {
    if (!this.logger || !this.config || !this.eventBus || !this.services || !this.env || !this.extensionManager) {
      throw new Error('Kernel not fully initialized');
    }
    return {
      logger: this.logger,
      config: this.config,
      eventBus: this.eventBus,
      services: this.services,
      env: this.env,
      kernel: {
        stop: () => this.stop(),
        getExtensionStates: (): {
          modules: Record<string, ExtensionState>;
          plugins: Record<string, ExtensionState>;
        } => this.extensionManager!.getExtensionStates(),
      },
    };
  }
}
