// src/core/kernel.ts
// Microkernel 主类：组装所有内核服务，编排插件生命周期。

import { detectEnvironment } from './env';
import { createRootLogger } from './logger';
import { createEventBus } from './event-bus';
import { createServiceRegistry } from './service-registry';
import { createConfigService } from './config-service';
import { PluginManager, type PluginManagerOptions } from './plugin-manager';
import type {
  KernelContext,
  Logger,
  EventBus,
  ServiceRegistry,
  ConfigService,
  Environment,
  PluginContext,
  PluginState,
  LogLevel,
} from './types';

export interface KernelStartOptions {
  /** 前台运行（不 detach） */
  foreground?: boolean;
  /** 插件管理器选项 */
  plugins?: PluginManagerOptions;
  /** 初始日志级别 */
  logLevel?: LogLevel;
}

export class Microkernel {
  private env: Environment | null = null;
  private logger: Logger | null = null;
  private eventBus: EventBus | null = null;
  private services: ServiceRegistry | null = null;
  private config: ConfigService | null = null;
  private pluginManager: PluginManager | null = null;
  private started = false;

  async start(options: KernelStartOptions = {}): Promise<KernelContext> {
    if (this.started) {
      throw new Error('Kernel already started');
    }

    // 1. 初始化内核服务
    this.env = detectEnvironment();
    this.logger = createRootLogger(this.env, options.logLevel ?? 'info');
    this.logger.info('MOSS-OS kernel starting', {
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
      this.logger.error('Failed to load config, using defaults', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 3. 构建插件上下文
    const context: PluginContext = {
      logger: this.logger,
      config: this.config,
      eventBus: this.eventBus,
      services: this.services,
      env: this.env,
    };

    // 4. 发现并加载插件
    this.pluginManager = new PluginManager(context, options.plugins ?? {});
    await this.pluginManager.discoverAndLoad();

    // 5. 按序初始化插件
    await this.pluginManager.initializeAll();

    this.started = true;
    await this.eventBus.broadcast('kernel:ready', { pid: this.env.pid });

    const activeCount = this.pluginManager.getActivePluginNames().length;
    this.logger.info('MOSS-OS kernel ready', {
      activePlugins: activeCount,
      services: this.services.list(),
    });

    return this.makeContext();
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.logger?.info('MOSS-OS kernel stopping');
    await this.eventBus?.broadcast('kernel:shutdown', {});

    if (this.pluginManager) {
      await this.pluginManager.destroyAll();
    }
    this.started = false;
    this.logger?.info('MOSS-OS kernel stopped');
  }

  isStarted(): boolean {
    return this.started;
  }

  private makeContext(): KernelContext {
    if (!this.logger || !this.config || !this.eventBus || !this.services || !this.env || !this.pluginManager) {
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
        getPluginStates: (): Record<string, PluginState> =>
          this.pluginManager!.getPluginStates(),
      },
    };
  }
}
