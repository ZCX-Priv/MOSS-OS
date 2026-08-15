// src/core/kernel.ts
// Microkernel 主类：组装所有内核服务，静态编排模块生命周期。
// 模块（modules）由内核直接静态 import，按固定顺序初始化、反向销毁。

import { reloadBackendResources, setBackendLocale, t } from './i18n';
import { detectEnvironment } from './env';
import { watch, existsSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { createRootLogger } from './logger';
import { createEventBus } from './event-bus';
import { createServiceRegistry } from './service-registry';
import { createConfigService } from './config-service';
import type {
  KernelContext,
  Logger,
  EventBus,
  ServiceRegistry,
  ConfigService,
  Environment,
  Module,
  ModuleContext,
  LogLevel,
} from './types';

import llm from '../modules/llm';
import tools from '../modules/tools';
import mcp from '../modules/mcp';
import server from '../modules/server';
import agents from '../modules/agents';
import update from '../modules/update';
import agent from '../modules/agent';
import fileHistory from '../modules/file-history';
import daemon from '../modules/daemon';
import automation from '../modules/automation';

const MODULE_INIT_TIMEOUT_MS = 30_000;
const MODULE_DESTROY_TIMEOUT_MS = 10_000;

/**
 * 静态模块注册表：固定初始化顺序满足依赖关系（被依赖者在前）。
 * - llm / tools / mcp / server / agents / update：无依赖
 * - agent → llm, tools
 * - file-history → tools
 * - daemon → server
 * - automation → agent, server
 */
const MODULE_FACTORIES: Array<{ name: string; create: () => Module }> = [
  { name: 'llm', create: llm },
  { name: 'tools', create: tools },
  { name: 'mcp', create: mcp },
  { name: 'server', create: server },
  { name: 'agents', create: agents },
  { name: 'update', create: update },
  { name: 'agent', create: agent },
  { name: 'file-history', create: fileHistory },
  { name: 'daemon', create: daemon },
  { name: 'automation', create: automation },
];

type ModuleState = 'loaded' | 'initializing' | 'active' | 'destroying' | 'shutdown' | 'error';

interface ModuleEntry {
  name: string;
  instance: Module;
  state: ModuleState;
}

export interface KernelStartOptions {
  /** 前台运行（不 detach） */
  foreground?: boolean;
  /** 初始日志级别 */
  logLevel?: LogLevel;
}

export class Microkernel {
  private env: Environment | null = null;
  private logger: Logger | null = null;
  private eventBus: EventBus | null = null;
  private services: ServiceRegistry | null = null;
  private config: ConfigService | null = null;
  private readonly modules: ModuleEntry[] = [];
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

    // 3. 构建模块上下文（完整能力）
    const moduleCtx: ModuleContext = {
      logger: this.logger,
      config: this.config,
      eventBus: this.eventBus,
      services: this.services,
      env: this.env,
    };

    // 4. 静态实例化并按序初始化模块（失败记日志并继续，与原拓扑编排韧性一致）
    for (const factory of MODULE_FACTORIES) {
      this.modules.push({ name: factory.name, instance: factory.create(), state: 'loaded' });
    }

    for (const entry of this.modules) {
      entry.state = 'initializing';
      try {
        await this.withTimeout(
          entry.instance.initialize(moduleCtx),
          MODULE_INIT_TIMEOUT_MS,
          `initialize(module:${entry.name})`,
        );
        entry.state = 'active';
        this.logger.info(t('kernel.moduleActivated', { name: entry.name }));
      } catch (err) {
        entry.state = 'error';
        this.logger.error(t('kernel.moduleInitFailed', { name: entry.name }), {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 暴露模块状态服务（供 health 路由使用）
    this.services.register(
      'kernel.modules',
      {
        getList: (): Array<{ name: string; state: ModuleState }> =>
          this.modules.map((m) => ({ name: m.name, state: m.state })),
      },
      { scope: 'kernel' },
    );

    this.started = true;
    await this.eventBus.broadcast('kernel:ready', { pid: this.env.pid });

    const activeCount = this.modules.filter((m) => m.state === 'active').length;
    this.logger.info(t('kernel.ready'), {
      activeModules: activeCount,
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

    // 反向顺序销毁
    for (const entry of [...this.modules].reverse()) {
      if (entry.state !== 'active') continue;
      entry.state = 'destroying';
      try {
        if (entry.instance.destroy) {
          await this.withTimeout(
            entry.instance.destroy(),
            MODULE_DESTROY_TIMEOUT_MS,
            `destroy(module:${entry.name})`,
          );
        }
        this.services?.unregisterScope(entry.name);
        this.eventBus?.offAll(entry.name);
        entry.state = 'shutdown';
        this.logger?.info(t('kernel.moduleDestroyed', { name: entry.name }));
      } catch (err) {
        entry.state = 'error';
        this.logger?.error(t('kernel.moduleDestroyFailed', { name: entry.name }), {
          error: err instanceof Error ? err.message : String(err),
        });
      }
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

  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Operation "${label}" timed out after ${ms}ms`)),
        ms,
      );
    });
    try {
      return Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private makeContext(): KernelContext {
    if (!this.logger || !this.config || !this.eventBus || !this.services || !this.env) {
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
      },
    };
  }
}
