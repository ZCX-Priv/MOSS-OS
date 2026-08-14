// src/core/kernel.ts
// Microkernel 主类：组装所有内核服务，编排模组/插件生命周期。
// 模组（modules）拥有高权限，先加载；插件（plugins）权限较低，后加载。

import { reloadBackendResources, setBackendLocale, t } from './i18n';
import { detectEnvironment } from './env';
import { watch, existsSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
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
  private i18nWatcher?: FSWatcher;
  private started = false;

  async start(options: KernelStartOptions = {}): Promise<KernelContext> {
    if (this.started) {
      throw new Error(t('kernel.alreadyStarted'));
    }

    // 1. 初始化内核服务
    this.env = detectEnvironment();
    this.logger = createRootLogger(this.env, options.logLevel ?? 'info');
    this.logger.info(t('kernel.starting'), {
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
      setBackendLocale(this.config.getAppConfig().server.locale === 'en' ? 'en' : 'zh');
      // 启动 i18n 资源目录 watcher，实现运行期文案就地热重载
      this.startBackendI18nWatcher();
      // 应用配置中的日志级别
      const cfgLevel = this.config.getAppConfig().daemon.logLevel;
      this.logger.setLevel(cfgLevel);
      this.logger.info(t('kernel.configLoaded'), { logLevel: cfgLevel });
    } catch (err) {
      this.logger.error(t('kernel.configLoadFailed'), {
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
    this.logger.info(t('kernel.ready'), {
      activeExtensions: activeCount,
      services: this.services.list(),
    });

    return this.makeContext();
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.logger?.info(t('kernel.stopping'));
    await this.eventBus?.broadcast('kernel:shutdown', {});

    if (this.extensionManager) {
      await this.extensionManager.destroyAll();
    }
    this.i18nWatcher?.close();
    this.i18nWatcher = undefined;
    this.started = false;
    this.logger?.info(t('kernel.stopped'));
  }

  isStarted(): boolean {
    return this.started;
  }

  /**
   * 启动对后端 i18n 资源目录（src/core/i18n/locales/）的防抖 watcher。
   * 变更时调用 reloadBackendResources() 就地重载，让运行中的 t() 立即反映磁盘文案改动。
   * 仅当目录存在（开发/未打包场景）时生效；失败仅记日志，不阻断启动。
   */
  private startBackendI18nWatcher(): void {
    if (!this.env || !this.logger) return;
    const dir = join(this.env.packageRoot, 'src', 'core', 'i18n', 'locales');
    if (!existsSync(dir)) {
      this.logger.debug('i18n locale dir not found, skipping watcher', { dir });
      return;
    }
    let debounce: ReturnType<typeof setTimeout> | null = null;
    try {
      this.i18nWatcher = watch(dir, { recursive: true }, () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          reloadBackendResources().catch(err => {
            this.logger?.warn('i18n reload failed', {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }, 300);
      });
      this.logger.debug('i18n locale watcher started', { dir });
    } catch (err) {
      this.logger.warn('i18n locale watcher start failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private makeContext(): KernelContext {
    if (!this.logger || !this.config || !this.eventBus || !this.services || !this.env || !this.extensionManager) {
      throw new Error(t('kernel.notInitialized'));
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
