// src/core/extension-manager.ts
// 扩展管理器：发现、加载、拓扑排序、生命周期管理。
// 替代原 plugin-manager.ts，分两阶段加载：模组（高权限）→ 插件（低权限）。
// - 模组：src/modules/*/module.json + index.ts，传入 ModuleContext（完整能力）
// - 插件：src/plugins/*/plugin.json + index.ts，传入 PluginContext（受限能力）
// 清单替代原 metadata，index.ts 导出工厂函数 (manifest) => Module | Plugin

import { readdir, stat, readFile, mkdir, cp } from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type {
  Environment,
  EventBus,
  ConfigService,
  Logger,
  ServiceRegistry,
  Module,
  Plugin,
  ModuleContext,
  PluginContext,
  ModuleManifest,
  PluginManifest,
  ExtensionManifest,
  ExtensionState,
} from './types';
import { createProtectedView } from './service-registry';

const EXTENSION_INIT_TIMEOUT_MS = 30_000;
const EXTENSION_DESTROY_TIMEOUT_MS = 10_000;

type ExtensionFactory<M extends Module | Plugin> = (manifest: M extends Module ? ModuleManifest : PluginManifest) => M;

interface ModuleEntry {
  module: Module;
  state: ExtensionState;
  modulePath: string;
  manifest: ModuleManifest;
}

interface PluginEntry {
  plugin: Plugin;
  state: ExtensionState;
  modulePath: string;
  manifest: PluginManifest;
}

export interface ExtensionManagerOptions {
  /** 自定义插件目录（绝对路径），默认空数组（仅加载内置 src/plugins） */
  extraPluginDirs?: string[];
  /** 是否禁用内置模组发现（测试用） */
  disableBuiltinModules?: boolean;
  /** 是否禁用内置插件发现 */
  disableBuiltinPlugins?: boolean;
}

interface KernelCoreContext {
  logger: Logger;
  config: ConfigService;
  eventBus: EventBus;
  services: ServiceRegistry;
  env: Environment;
}

export class ExtensionManager {
  private readonly modules = new Map<string, ModuleEntry>();
  private readonly plugins = new Map<string, PluginEntry>();
  private readonly coreCtx: KernelCoreContext;
  private readonly logger: Logger;
  private readonly env: Environment;
  private readonly options: ExtensionManagerOptions;
  /** 合并后的加载顺序（模组在前，插件在后；各自内部按拓扑序） */
  private loadOrder: Array<{ name: string; kind: 'module' | 'plugin' }> = [];
  /** 被用户禁用的扩展名集合（持久化到 ~/.moss/extensions.json） */
  private readonly disabledExtensions = new Set<string>();

  constructor(coreCtx: KernelCoreContext, options: ExtensionManagerOptions = {}) {
    this.coreCtx = coreCtx;
    this.logger = coreCtx.logger.child('ExtensionManager');
    this.env = coreCtx.env;
    this.options = options;
    this.loadDisabledList();
  }

  /** 加载禁用列表 from ~/.moss/extensions.json */
  private loadDisabledList(): void {
    const disabledPath = join(this.env.dataDir, 'extensions.json');
    try {
      const raw = readFileSync(disabledPath, 'utf8');
      const parsed = JSON.parse(raw) as { disabled?: string[] };
      if (Array.isArray(parsed.disabled)) {
        for (const name of parsed.disabled) {
          this.disabledExtensions.add(name);
        }
      }
    } catch {
      // 文件不存在或解析失败，空集合
    }
  }

  /** 持久化禁用列表 to ~/.moss/extensions.json */
  private saveDisabledList(): void {
    const disabledPath = join(this.env.dataDir, 'extensions.json');
    try {
      mkdirSync(dirname(disabledPath), { recursive: true });
      const data = { disabled: Array.from(this.disabledExtensions) };
      writeFileSync(disabledPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      this.logger.error('Failed to save extensions.json', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 启用扩展（从禁用列表移除，下次启动生效） */
  enable(name: string): boolean {
    if (!this.disabledExtensions.has(name)) return false;
    this.disabledExtensions.delete(name);
    this.saveDisabledList();
    return true;
  }

  /** 禁用扩展（加入禁用列表，下次启动生效） */
  disable(name: string): boolean {
    if (this.disabledExtensions.has(name)) return false;
    this.disabledExtensions.add(name);
    this.saveDisabledList();
    return true;
  }

  /** 检查扩展是否被禁用 */
  isDisabled(name: string): boolean {
    return this.disabledExtensions.has(name);
  }

  /**
   * 发现并加载所有扩展。
   * 阶段 1：扫描 src/modules/<name>/module.json + index.ts
   * 阶段 2：扫描 src/plugins/<name>/plugin.json + index.ts
   * 阶段 3：合并拓扑排序（模组优先入度 0）
   */
  async discoverAndLoad(): Promise<void> {
    // 阶段 1：模组
    const moduleCandidates = this.options.disableBuiltinModules
      ? []
      : await this.discoverInDirs(
          [join(this.env.packageRoot, 'src', 'modules'), join(this.env.packageRoot, 'dist', 'modules')],
          'module.json',
        );

    // 阶段 2：插件
    // 用户目录 ~/.moss/plugins 为主加载源（与 skills/mcps 架构一致）
    const userPluginsDir = join(this.env.dataDir, 'plugins');
    const builtinPluginDirs: string[] = [];
    if (!this.options.disableBuiltinPlugins) {
      builtinPluginDirs.push(
        join(this.env.packageRoot, 'src', 'plugins'),
        join(this.env.packageRoot, 'dist', 'plugins'),
      );
      // 首次启动播种：从包内模板复制到 ~/.moss/plugins
      await this.seedBuiltinPlugins(userPluginsDir, builtinPluginDirs);
    }
    // 加载顺序：用户目录优先（覆盖同名）> 包内模板 > extraPluginDirs
    const pluginDirs: string[] = [userPluginsDir, ...builtinPluginDirs];
    if (this.options.extraPluginDirs) {
      pluginDirs.push(...this.options.extraPluginDirs);
    }
    const pluginCandidates = await this.discoverInDirs(pluginDirs, 'plugin.json');

    this.logger.info(`Discovered ${moduleCandidates.length} module candidates, ${pluginCandidates.length} plugin candidates`, {
      modules: moduleCandidates.map(c => c.name),
      plugins: pluginCandidates.map(c => c.name),
    });

    // 过滤掉被用户禁用的扩展
    const enabledModuleCandidates = moduleCandidates.filter(c => !this.disabledExtensions.has(c.name));
    const enabledPluginCandidates = pluginCandidates.filter(c => !this.disabledExtensions.has(c.name));
    if (this.disabledExtensions.size > 0) {
      this.logger.info(`Skipping disabled extensions`, {
        disabled: Array.from(this.disabledExtensions),
      });
    }

    // 并行 import 所有扩展
    const [moduleResults, pluginResults] = await Promise.all([
      Promise.allSettled(enabledModuleCandidates.map(c => this.loadModule(c))),
      Promise.allSettled(enabledPluginCandidates.map(c => this.loadPlugin(c))),
    ]);

    moduleResults.forEach((r, idx) => {
      const c = enabledModuleCandidates[idx];
      if (r.status === 'fulfilled') {
        this.modules.set(r.value.manifest.name, r.value);
      } else {
        this.logger.error(`Failed to load module "${c.name}"`, {
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    });
    pluginResults.forEach((r, idx) => {
      const c = enabledPluginCandidates[idx];
      if (r.status === 'fulfilled') {
        this.plugins.set(r.value.manifest.name, r.value);
      } else {
        this.logger.error(`Failed to load plugin "${c.name}"`, {
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    });

    // 阶段 3：合并拓扑排序（模组优先入度 0）
    this.loadOrder = this.combinedTopoSort();

    this.logger.info('Extensions loaded', {
      order: this.loadOrder.map(o => `${o.kind}:${o.name}`),
      total: this.loadOrder.length,
    });
  }

  /**
   * 按拓扑顺序初始化所有扩展。
   * 模组传入 ModuleContext（完整）；插件传入 PluginContext（受限）。
   */
  async initializeAll(): Promise<void> {
    const failed = new Set<string>();

    for (const { name, kind } of this.loadOrder) {
      const entry = kind === 'module' ? this.modules.get(name) : this.plugins.get(name);
      if (!entry) continue;

      const manifest = entry.manifest;
      const deps = manifest.dependencies ?? {};
      const failedDeps = Object.keys(deps).filter(d => failed.has(d));
      if (failedDeps.length > 0) {
        this.logger.warn(
          `${kind} "${name}" skipped: dependencies failed [${failedDeps.join(', ')}]`,
        );
        entry.state = 'error';
        failed.add(name);
        continue;
      }

      entry.state = 'initializing';
      try {
        if (kind === 'module') {
          const mod = (entry as ModuleEntry).module;
          const ctx: ModuleContext = {
            logger: this.coreCtx.logger.child(`module:${name}`),
            config: this.coreCtx.config,
            eventBus: this.coreCtx.eventBus,
            services: this.coreCtx.services,
            env: this.coreCtx.env,
          };
          await this.withTimeout(mod.initialize(ctx), EXTENSION_INIT_TIMEOUT_MS, `initialize(module:${name})`);
        } else {
          const plg = (entry as PluginEntry).plugin;
          const allowed = new Set<string>(manifest.permissions?.consumeServices ?? []);
          const ctx: PluginContext = {
            logger: this.coreCtx.logger.child(`plugin:${name}`),
            config: this.coreCtx.config,
            eventBus: this.coreCtx.eventBus,
            services: createProtectedView(this.coreCtx.services, allowed, name),
            env: this.coreCtx.env,
          };
          await this.withTimeout(plg.initialize(ctx), EXTENSION_INIT_TIMEOUT_MS, `initialize(plugin:${name})`);
        }
        entry.state = 'active';
        this.logger.info(`${kind} "${name}" v${manifest.version} activated`);
        await this.coreCtx.eventBus.broadcast('plugin:loaded', { kind, name, version: manifest.version });
      } catch (err) {
        entry.state = 'error';
        failed.add(name);
        this.logger.error(`${kind} "${name}" initialization failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
        await this.coreCtx.eventBus.broadcast('plugin:error', {
          kind,
          name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /** 反向顺序销毁所有扩展 */
  async destroyAll(): Promise<void> {
    const reverse = [...this.loadOrder].reverse();
    for (const { name, kind } of reverse) {
      const entry = kind === 'module' ? this.modules.get(name) : this.plugins.get(name);
      if (!entry || entry.state !== 'active') continue;

      entry.state = 'destroying';
      try {
        const target = kind === 'module' ? (entry as ModuleEntry).module : (entry as PluginEntry).plugin;
        if (target.destroy) {
          await this.withTimeout(target.destroy(), EXTENSION_DESTROY_TIMEOUT_MS, `destroy(${kind}:${name})`);
        }
        this.coreCtx.services.unregisterScope(name);
        this.coreCtx.eventBus.offAll(name);
        entry.state = 'shutdown';
        this.logger.info(`${kind} "${name}" destroyed`);
        await this.coreCtx.eventBus.broadcast('plugin:unloaded', { kind, name });
      } catch (err) {
        entry.state = 'error';
        this.logger.error(`${kind} "${name}" destroy failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  getExtensionStates(): {
    modules: Record<string, ExtensionState>;
    plugins: Record<string, ExtensionState>;
  } {
    const modules: Record<string, ExtensionState> = {};
    for (const [name, e] of this.modules) modules[name] = e.state;
    const plugins: Record<string, ExtensionState> = {};
    for (const [name, e] of this.plugins) plugins[name] = e.state;
    return { modules, plugins };
  }

  getActiveExtensionCount(): number {
    let count = 0;
    for (const e of this.modules.values()) if (e.state === 'active') count++;
    for (const e of this.plugins.values()) if (e.state === 'active') count++;
    return count;
  }

  /**
   * 返回所有扩展的完整信息列表（供 /api/extensions 路由使用）。
   * 包含已加载和被禁用（未加载）的扩展。
   */
  getExtensionList(): Array<{
    name: string;
    version: string;
    description?: string;
    type: 'module' | 'plugin';
    state: ExtensionState;
    enabled: boolean;
  }> {
    const list: Array<{
      name: string;
      version: string;
      description?: string;
      type: 'module' | 'plugin';
      state: ExtensionState;
      enabled: boolean;
    }> = [];

    for (const [name, entry] of this.modules) {
      list.push({
        name,
        version: entry.manifest.version,
        description: entry.manifest.description,
        type: 'module',
        state: entry.state,
        enabled: !this.disabledExtensions.has(name),
      });
    }
    for (const [name, entry] of this.plugins) {
      list.push({
        name,
        version: entry.manifest.version,
        description: entry.manifest.description,
        type: 'plugin',
        state: entry.state,
        enabled: !this.disabledExtensions.has(name),
      });
    }

    // 追加被禁用但未加载的扩展（仅在禁用列表中但不在 modules/plugins maps 中的）
    // 注意：当前实现中，被禁用的扩展在 discoverAndLoad 时已被过滤，
    // 所以它们不会出现在 modules/plugins maps 中。但由于我们没有持久化它们的
    // manifest 信息，这里无法返回它们的 version/description。
    // 前端可通过 enabled=false 标记识别。

    return list;
  }

  // ========================================================================
  // 内部：发现与加载
  // ========================================================================

  /**
   * 首次启动播种：若 ~/.moss/plugins 不存在，从包内模板目录递归复制所有插件子目录。
   * 仅当目标目录不存在时执行，用户删除的插件不会被重新添加。
   * 播种失败不阻断启动，仅记录日志。
   */
  private async seedBuiltinPlugins(userDir: string, builtinDirs: string[]): Promise<void> {
    try {
      await stat(userDir);
      return; // 已存在，不覆盖用户修改
    } catch {
      // 不存在，继续播种
    }
    await mkdir(userDir, { recursive: true }).catch(() => {});
    let seeded = 0;
    for (const builtinDir of builtinDirs) {
      let entries: string[];
      try {
        entries = await readdir(builtinDir);
      } catch {
        continue; // 内置目录不存在（开发模式），跳过
      }
      for (const name of entries) {
        const src = join(builtinDir, name);
        const s = await stat(src).catch(() => null);
        if (!s || !s.isDirectory()) continue;
        const dest = join(userDir, name);
        // 仅复制目标不存在的插件子目录（避免多个 builtinDir 间互相覆盖）
        const destExists = await stat(dest).catch(() => null);
        if (destExists) continue;
        await cp(src, dest, { recursive: true }).catch(err => {
          this.logger.debug(`Failed to seed builtin plugin ${name}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        });
        seeded++;
      }
    }
    this.logger.info(`Seeded builtin plugins to ${userDir}`, { count: seeded });
  }

  private async discoverInDirs(
    dirs: string[],
    manifestName: 'module.json' | 'plugin.json',
  ): Promise<Array<{ name: string; dir: string; indexPath: string; manifestPath: string }>> {
    const seen = new Set<string>();
    const result: Array<{ name: string; dir: string; indexPath: string; manifestPath: string }> = [];

    for (const dir of dirs) {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (seen.has(name)) continue;
        const full = join(dir, name);
        const s = await stat(full).catch(() => null);
        if (!s || !s.isDirectory()) continue;

        const manifestPath = join(full, manifestName);
        const idxTs = join(full, 'index.ts');
        const idxJs = join(full, 'index.js');
        const hasManifest = await stat(manifestPath).catch(() => null);
        const idxTsStat = await stat(idxTs).catch(() => null);
        const idxJsStat = await stat(idxJs).catch(() => null);
        if (!hasManifest) continue;
        const indexPath = idxTsStat ? idxTs : idxJsStat ? idxJs : null;
        if (!indexPath) continue;
        seen.add(name);
        result.push({ name, dir: full, indexPath, manifestPath });
      }
    }
    return result;
  }

  private async loadModule(
    c: { name: string; dir: string; indexPath: string; manifestPath: string },
  ): Promise<ModuleEntry> {
    const manifest = await this.readManifest<ModuleManifest>(c.manifestPath, 'module');
    const mod = await import(c.indexPath);
    const factory = (mod.default ?? mod.module) as ExtensionFactory<Module> | undefined;
    if (typeof factory !== 'function') {
      throw new Error(
        `Module "${c.indexPath}" must export a default factory (manifest) => Module`,
      );
    }
    const instance = factory(manifest);
    if (!instance || typeof instance.initialize !== 'function') {
      throw new Error(`Module factory for "${c.name}" did not return a valid Module instance`);
    }
    instance.manifest = manifest;
    return { module: instance, state: 'loaded', modulePath: c.indexPath, manifest };
  }

  private async loadPlugin(
    c: { name: string; dir: string; indexPath: string; manifestPath: string },
  ): Promise<PluginEntry> {
    const manifest = await this.readManifest<PluginManifest>(c.manifestPath, 'plugin');
    const mod = await import(c.indexPath);
    const factory = (mod.default ?? mod.plugin) as ExtensionFactory<Plugin> | undefined;
    if (typeof factory !== 'function') {
      throw new Error(
        `Plugin "${c.indexPath}" must export a default factory (manifest) => Plugin`,
      );
    }
    const instance = factory(manifest);
    if (!instance || typeof instance.initialize !== 'function') {
      throw new Error(`Plugin factory for "${c.name}" did not return a valid Plugin instance`);
    }
    instance.manifest = manifest;
    return { plugin: instance, state: 'loaded', modulePath: c.indexPath, manifest };
  }

  private async readManifest<M extends ModuleManifest | PluginManifest>(
    manifestPath: string,
    expectedType: 'module' | 'plugin',
  ): Promise<M> {
    const raw = await readFile(manifestPath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse manifest ${manifestPath}: ${err instanceof Error ? err.message : err}`);
    }
    const m = parsed as Partial<ExtensionManifest>;
    if (!m || typeof m !== 'object') {
      throw new Error(`Manifest ${manifestPath} is not an object`);
    }
    if (typeof m.name !== 'string' || typeof m.version !== 'string') {
      throw new Error(`Manifest ${manifestPath} missing required fields "name" and "version"`);
    }
    // type 字段允许缺省，由 manifestName 隐式决定；若存在必须匹配
    if (m.type !== undefined && m.type !== expectedType) {
      throw new Error(
        `Manifest ${manifestPath} type mismatch: expected "${expectedType}", got "${m.type}"`,
      );
    }
    const manifest = { ...(m as Record<string, unknown>), type: expectedType } as unknown as M;
    return manifest;
  }

  // ========================================================================
  // 内部：合并拓扑排序
  // ========================================================================

  /**
   * 合并拓扑排序：模组与插件统一参与，模组优先入队（同等入度时模组先出队）。
   * 这样可保证核心服务由模组先注册，插件后初始化时能消费到。
   */
  private combinedTopoSort(): Array<{ name: string; kind: 'module' | 'plugin' }> {
    type Node = { name: string; kind: 'module' | 'plugin'; deps: Set<string>; dependents: Set<string>; inDegree: number };

    const nodes = new Map<string, Node>();
    const addNode = (name: string, kind: 'module' | 'plugin', deps: Record<string, string> | undefined) => {
      nodes.set(name, {
        name,
        kind,
        deps: new Set(Object.keys(deps ?? {})),
        dependents: new Set(),
        inDegree: 0,
      });
    };

    for (const [name, e] of this.modules) addNode(name, 'module', e.manifest.dependencies);
    for (const [name, e] of this.plugins) addNode(name, 'plugin', e.manifest.dependencies);

    // 计算入度
    for (const node of nodes.values()) {
      for (const dep of node.deps) {
        if (!nodes.has(dep)) {
          this.logger.warn(
            `${node.kind} "${node.name}" depends on missing extension "${dep}", will skip during init`,
          );
          continue;
        }
        nodes.get(dep)!.dependents.add(node.name);
        node.inDegree++;
      }
    }

    // 模组优先入队
    const queue: Node[] = [];
    for (const n of nodes.values()) {
      if (n.inDegree === 0) queue.push(n);
    }
    queue.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'module' ? -1 : 1));

    const sorted: Array<{ name: string; kind: 'module' | 'plugin' }> = [];
    while (queue.length > 0) {
      const n = queue.shift()!;
      sorted.push({ name: n.name, kind: n.kind });
      const newZero: Node[] = [];
      for (const dep of n.dependents) {
        const d = nodes.get(dep)!;
        d.inDegree--;
        if (d.inDegree === 0) newZero.push(d);
      }
      // 模组优先：新入度 0 的节点也按 kind 排序后追加
      newZero.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'module' ? -1 : 1));
      queue.push(...newZero);
    }

    if (sorted.length !== nodes.size) {
      const cyclic: Array<{ name: string; kind: 'module' | 'plugin' }> = [];
      for (const n of nodes.values()) {
        if (!sorted.some(s => s.name === n.name)) cyclic.push({ name: n.name, kind: n.kind });
      }
      this.logger.error(
        `Circular dependency detected among extensions: [${cyclic.map(c => `${c.kind}:${c.name}`).join(', ')}]`,
      );
      cyclic.sort((a, b) => a.name.localeCompare(b.name));
      sorted.push(...cyclic);
    }

    return sorted;
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
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
