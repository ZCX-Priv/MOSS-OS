// src/core/plugin-manager.ts
// 插件管理器：发现、加载、拓扑排序、生命周期管理。

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Plugin,
  PluginContext,
  PluginMetadata,
  PluginState,
  Environment,
  EventBus,
  ServiceRegistry,
  ConfigService,
  Logger,
} from './types';

const PLUGIN_INIT_TIMEOUT_MS = 30_000;
const PLUGIN_DESTROY_TIMEOUT_MS = 10_000;

interface PluginEntry {
  plugin: Plugin;
  state: PluginState;
  /** 插件源码目录的绝对路径（动态 import 用） */
  modulePath: string;
}

export interface PluginManagerOptions {
  /** 自定义插件目录（绝对路径），默认使用内置 src/plugins */
  extraPluginDirs?: string[];
  /** 是否禁用内置插件发现（测试用） */
  disableBuiltin?: boolean;
}

export class PluginManager {
  private readonly entries = new Map<string, PluginEntry>();
  private readonly context: PluginContext;
  private readonly logger: Logger;
  private readonly env: Environment;
  private readonly options: PluginManagerOptions;
  /** 加载顺序（拓扑排序后），用于反向 destroy */
  private loadOrder: string[] = [];

  constructor(
    context: {
      logger: Logger;
      config: ConfigService;
      eventBus: EventBus;
      services: ServiceRegistry;
      env: Environment;
    },
    options: PluginManagerOptions = {},
  ) {
    this.context = context;
    this.logger = context.logger.child('PluginManager');
    this.env = context.env;
    this.options = options;
  }

  /**
   * 发现并加载所有插件。
   * 步骤：
   *  1. 扫描插件目录
   *  2. 动态 import 每个插件的 index.ts
   *  3. 收集所有插件元数据
   *  4. 拓扑排序
   *  5. 按序注册到 entries（state=loaded）
   */
  async discoverAndLoad(): Promise<void> {
    const dirs: string[] = [];
    if (!this.options.disableBuiltin) {
      // 内置插件目录：编译前 src/plugins，编译后 dist/plugins（若打包）
      // 由于 bun build 单文件不会保留目录结构，开发/运行均使用 src/plugins
      const builtinDir = join(this.env.packageRoot, 'src', 'plugins');
      dirs.push(builtinDir);
      // 也尝试从 dist/plugins 加载（生产环境兼容）
      const distDir = join(this.env.packageRoot, 'dist', 'plugins');
      dirs.push(distDir);
    }
    if (this.options.extraPluginDirs) {
      dirs.push(...this.options.extraPluginDirs);
    }

    const candidates: Array<{ name: string; path: string }> = [];
    for (const dir of dirs) {
      const found = await this.scanPluginDir(dir).catch(err => {
        this.logger.debug(`Plugin dir scan skipped: ${dir}`, {
          error: err instanceof Error ? err.message : String(err),
        });
        return [] as Array<{ name: string; path: string }>;
      });
      for (const c of found) {
        // 同名插件：先发现的优先（builtin 优先于 dist）
        if (!candidates.some(x => x.name === c.name)) {
          candidates.push(c);
        }
      }
    }

    this.logger.info(`Discovered ${candidates.length} plugin candidates`, {
      names: candidates.map(c => c.name),
    });

    // 并行 import 所有插件模块
    const loadResults = await Promise.allSettled(
      candidates.map(async c => {
        const mod = await import(c.path);
        const plugin: Plugin = mod.default ?? mod.plugin;
        if (!plugin || !plugin.metadata || typeof plugin.initialize !== 'function') {
          throw new Error(
            `Plugin module "${c.path}" must export a default Plugin object with metadata and initialize()`,
          );
        }
        return { plugin, modulePath: c.path };
      }),
    );

    const loaded: Array<{ plugin: Plugin; modulePath: string }> = [];
    loadResults.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        loaded.push(r.value);
        this.entries.set(r.value.plugin.metadata.name, {
          plugin: r.value.plugin,
          state: 'loaded',
          modulePath: r.value.modulePath,
        });
      } else {
        this.logger.error(`Failed to load plugin "${candidates[idx].name}"`, {
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    });

    // 拓扑排序
    this.loadOrder = this.topoSort(loaded.map(l => l.plugin.metadata));

    this.logger.info('Plugins loaded', {
      order: this.loadOrder,
      total: this.loadOrder.length,
    });
  }

  /**
   * 按拓扑顺序初始化所有插件。
   * 单个插件初始化失败不影响其他（标记为 error，跳过依赖它的插件）。
   */
  async initializeAll(): Promise<void> {
    const failed = new Set<string>();
    for (const name of this.loadOrder) {
      const entry = this.entries.get(name);
      if (!entry) continue;

      // 检查依赖是否失败
      const deps = entry.plugin.metadata.dependencies ?? {};
      const failedDeps = Object.keys(deps).filter(d => failed.has(d));
      if (failedDeps.length > 0) {
        this.logger.warn(
          `Plugin "${name}" skipped: dependencies failed [${failedDeps.join(', ')}]`,
        );
        entry.state = 'error';
        failed.add(name);
        continue;
      }

      entry.state = 'initializing';
      try {
        await this.withTimeout(
          entry.plugin.initialize(this.context),
          PLUGIN_INIT_TIMEOUT_MS,
          `initialize(${name})`,
        );
        entry.state = 'active';
        this.logger.info(`Plugin "${name}" v${entry.plugin.metadata.version} activated`);
        await this.context.eventBus.broadcast('plugin:loaded', {
          name,
          version: entry.plugin.metadata.version,
        });
      } catch (err) {
        entry.state = 'error';
        failed.add(name);
        this.logger.error(`Plugin "${name}" initialization failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
        await this.context.eventBus.broadcast('plugin:error', {
          name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * 反向顺序销毁所有插件。
   * 单个插件销毁失败仅记录，继续销毁其他。
   */
  async destroyAll(): Promise<void> {
    const reverse = [...this.loadOrder].reverse();
    for (const name of reverse) {
      const entry = this.entries.get(name);
      if (!entry) continue;
      if (entry.state !== 'active') continue;

      entry.state = 'destroying';
      try {
        if (entry.plugin.destroy) {
          await this.withTimeout(
            entry.plugin.destroy(),
            PLUGIN_DESTROY_TIMEOUT_MS,
            `destroy(${name})`,
          );
        }
        // 注销该插件注册的所有服务和事件 handler
        this.context.services.unregisterScope(name);
        this.context.eventBus.offAll(name);
        entry.state = 'shutdown';
        this.logger.info(`Plugin "${name}" destroyed`);
        await this.context.eventBus.broadcast('plugin:unloaded', { name });
      } catch (err) {
        entry.state = 'error';
        this.logger.error(`Plugin "${name}" destroy failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  getPluginStates(): Record<string, PluginState> {
    const result: Record<string, PluginState> = {};
    for (const [name, entry] of this.entries) {
      result[name] = entry.state;
    }
    return result;
  }

  getActivePluginNames(): string[] {
    return this.loadOrder.filter(name => {
      const e = this.entries.get(name);
      return e?.state === 'active';
    });
  }

  // ========================================================================
  // 内部工具
  // ========================================================================

  private async scanPluginDir(
    dir: string,
  ): Promise<Array<{ name: string; path: string }>> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }
    const result: Array<{ name: string; path: string }> = [];
    for (const name of entries) {
      const full = join(dir, name);
      const s = await stat(full).catch(() => null);
      if (!s || !s.isDirectory()) continue;
      // 检查是否有 index.ts 或 index.js
      // Bun 可直接 import .ts
      const indexPathTs = join(full, 'index.ts');
      const indexPathJs = join(full, 'index.js');
      const idxTs = await stat(indexPathTs).catch(() => null);
      const idxJs = await stat(indexPathJs).catch(() => null);
      if (idxTs) {
        result.push({ name, path: indexPathTs });
      } else if (idxJs) {
        result.push({ name, path: indexPathJs });
      }
    }
    return result;
  }

  /**
   * Kahn 算法拓扑排序。检测循环依赖和缺失依赖。
   */
  private topoSort(metadatas: PluginMetadata[]): string[] {
    const nameSet = new Set(metadatas.map(m => m.name));
    const deps = new Map<string, Set<string>>();
    const dependents = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    for (const m of metadatas) {
      deps.set(m.name, new Set());
      dependents.set(m.name, new Set());
      inDegree.set(m.name, 0);
    }

    for (const m of metadatas) {
      const depMap = m.dependencies ?? {};
      for (const depName of Object.keys(depMap)) {
        if (!nameSet.has(depName)) {
          this.logger.warn(
            `Plugin "${m.name}" depends on missing plugin "${depName}", will skip during init`,
          );
          continue;
        }
        deps.get(m.name)!.add(depName);
        dependents.get(depName)!.add(m.name);
        inDegree.set(m.name, (inDegree.get(m.name) ?? 0) + 1);
      }
    }

    // 入度为 0 的优先入队
    const queue: string[] = [];
    for (const [name, deg] of inDegree) {
      if (deg === 0) queue.push(name);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      // 取队列头部
      const name = queue.shift()!;
      sorted.push(name);
      for (const dependent of dependents.get(name) ?? []) {
        const newDeg = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, newDeg);
        if (newDeg === 0) queue.push(dependent);
      }
    }

    if (sorted.length !== metadatas.length) {
      const cyclic = metadatas.filter(m => !sorted.includes(m.name)).map(m => m.name);
      this.logger.error(`Circular dependency detected among plugins: [${cyclic.join(', ')}]`);
      // 把循环依赖的插件也加入（按字母序），让它们尝试初始化（大概率失败，但保持进程继续）
      cyclic.sort();
      sorted.push(...cyclic);
    }

    return sorted;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Operation "${label}" timed out after ${ms}ms`)),
        ms,
      );
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
