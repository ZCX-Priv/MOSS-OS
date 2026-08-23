// src/modules/tools/index.ts
// Tools 模块入口：注册 ToolRegistry + 内置工具 + SkillRegistry。
// 工具从 tools 目录的「tool.json + index.ts」结构加载，新增工具只需加目录。
// 支持配置热重载（enabled 变更即时生效）和文件级增量热重载（tool.json/index.ts 变更即时生效）。

import { t } from '../../core/i18n';
import type { Module, ModuleContext, } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { join } from 'node:path';
import { existsSync, statSync, watch, type FSWatcher } from 'node:fs';
import { ToolRegistryImpl } from './registry';
import { createSkillRegistry } from './use_skill/registry';
import { createCommandRegistry } from './use_command/registry';
import { createSpecRegistry } from './get_spec/registry';
import { BUILTIN_TOOL_NAMES } from './manifest';
import { loadToolsFromDir, loadToolFromDir, resolveBuiltinDir } from './loader';
import type { Tool } from './types';

class ToolsModule implements Module {

  private registry: ToolRegistryImpl | null = null;
  private ctx: ModuleContext | null = null;
  /** 已加载的内置工具（含 disabled 的，供 config 热重载启用时直接注册） */
  private loadedBuiltinTools: Tool[] = [];
  private builtinWatcher?: FSWatcher;
  private customWatcher?: FSWatcher;

  async initialize(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;
    this.registry = new ToolRegistryImpl(ctx.logger, ctx.config);
    const skillRegistry = createSkillRegistry(ctx.env, ctx.logger, ctx.eventBus, ctx.config);
    const commandRegistry = createCommandRegistry(ctx.env, ctx.logger, ctx.eventBus, ctx.config);
    const specRegistry = createSpecRegistry(ctx.env, ctx.logger, ctx.eventBus);

    // 1. 加载并注册内置工具（从 tools 目录，按 config 过滤）
    await this.loadAndRegisterBuiltinTools(ctx);

    // 2. 加载自定义工具（~/.moss/tools/）
    await this.loadCustomTools(ctx);

    // 3. 注册服务（受保护服务名，由模块注册）
    ctx.services.register(ServiceNames.TOOL_REGISTRY, this.registry, {
      scope: 'tools',
    });
    ctx.services.register(ServiceNames.SKILL_REGISTRY, skillRegistry, {
      scope: 'tools',
    });
    ctx.services.register(ServiceNames.COMMAND_REGISTRY, commandRegistry, {
      scope: 'tools',
    });
    ctx.services.register(ServiceNames.SPEC_REGISTRY, specRegistry, {
      scope: 'tools',
    });

    // 4. 热重载：工具启用/禁用由 registry.isEnabled 实时读取 config，
    //    listSchemas()/execute() 据此过滤，无需在此监听 config 变更做增删注册。
    //    文件级热重载（tool.json/index.ts 变更）由下方 startBuiltinWatch/startCustomWatch 处理。

    ctx.logger.info(t('tools.moduleInitialized'), {
      tools: this.registry.list().length,
    });
  }

  /** 从 tools 目录加载所有内置工具并注册（含 disabled，启用状态由 registry 实时过滤） */
  private async loadAndRegisterBuiltinTools(ctx: ModuleContext): Promise<void> {
    const builtinDir = resolveBuiltinDir(ctx.env);
    if (!builtinDir) {
      ctx.logger.warn(t('tools.builtinDirNotFound'), {
        checked: [
          join(ctx.env.packageRoot, 'src', 'modules', 'tools'),
          join(ctx.env.packageRoot, 'dist', 'modules', 'tools'),
        ],
      });
      return;
    }

    ctx.logger.info(t('tools.loadingBuiltin'), { dir: builtinDir });
    this.loadedBuiltinTools = await loadToolsFromDir(builtinDir, ctx.env, ctx.logger, 'builtin');

    // 注册全部内置工具（含 disabled 的）：启用状态由 registry.isEnabled 实时读取 config，
    // listSchemas() 据此过滤给 LLM。这样 config 变更无需增删注册，且前端可见全部工具。
    for (const tool of this.loadedBuiltinTools) {
      this.registry!.register(tool);
    }

    // 启动内置工具目录热重载监听
    this.startBuiltinWatch(builtinDir, ctx);
  }

  /** 从 ~/.moss/tools/ 加载自定义工具（错误隔离，单个失败不影响其他） */
  private async loadCustomTools(ctx: ModuleContext): Promise<void> {
    const dir = join(ctx.env.dataDir, 'tools');
    if (!existsSync(dir)) return;

    ctx.logger.info(t('tools.loadingCustom'), { dir });
    await this.loadCustomToolsFromDir(dir, ctx);

    // 启动自定义工具目录热重载监听
    this.startCustomWatch(dir, ctx);
  }

  /** 扫描目录并加载所有自定义工具子目录 */
  private async loadCustomToolsFromDir(dir: string, ctx: ModuleContext): Promise<void> {
    const tools = await loadToolsFromDir(dir, ctx.env, ctx.logger, 'custom');
    for (const tool of tools) {
      // 不允许覆盖内置工具
      if (BUILTIN_TOOL_NAMES.has(tool.name)) {
        ctx.logger.warn(t('tools.customConflictsBuiltin', { name: tool.name, dir: tool.sourceDir ?? '' }));
        continue;
      }
      this.registry!.register(tool);
      ctx.logger.info(t('tools.customLoaded', { name: tool.name }), { dir: tool.sourceDir });
    }
  }

  /** 启动内置工具目录热重载监听（增量，防抖 300ms） */
  private startBuiltinWatch(builtinDir: string, ctx: ModuleContext): void {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    try {
      this.builtinWatcher = watch(builtinDir, { recursive: true }, (_eventType, filename) => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          this.reloadToolByFilename(builtinDir, filename, ctx, 'builtin').catch(err => {
            ctx.logger.error(t('tools.builtinReloadFailed'), {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }, 300);
      });
    } catch (err) {
      ctx.logger.warn(t('tools.watchBuiltinFailed'), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 启动自定义工具目录热重载监听（增量，防抖 300ms） */
  private startCustomWatch(customDir: string, ctx: ModuleContext): void {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    try {
      this.customWatcher = watch(customDir, { recursive: true }, (_eventType, filename) => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          this.reloadToolByFilename(customDir, filename, ctx, 'custom').catch(err => {
            ctx.logger.error(t('tools.customReloadFailed'), {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }, 300);
      });
    } catch (err) {
      ctx.logger.warn(t('tools.watchCustomFailed'), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 按 watch 的 filename 增量重载单个工具。
   * filename 形如 'read/tool.json' 或 'read/index.ts'，取首段为工具子目录名。
   * 若无法提取 filename，回退到全量重载该来源的所有工具。
   * 守卫：首段含 '.'（顶层文件，如 loader.ts）或目录无 tool.json（如 shared/）时静默跳过。
   */
  private async reloadToolByFilename(
    rootDir: string,
    filename: string | Buffer | null,
    ctx: ModuleContext,
    source: 'builtin' | 'custom',
  ): Promise<void> {
    if (!this.registry) return;

    if (filename === null || Buffer.isBuffer(filename)) {
      // 无法定位具体文件，全量重载
      await this.fullReload(rootDir, ctx, source);
      return;
    }

    // 提取工具子目录名（filename 首段，兼容 / 和 \）
    const parts = filename.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length === 0) {
      await this.fullReload(rootDir, ctx, source);
      return;
    }

    // 顶层文件变更（非工具子目录），静默跳过
    if (parts[0].includes('.')) {
      return;
    }

    const toolDir = join(rootDir, parts[0]);
    const toolName = parts[0];

    // 检查目录是否还存在（可能被删除）
    let dirExists = false;
    try {
      dirExists = statSync(toolDir).isDirectory();
    } catch {
      dirExists = false;
    }

    // 非工具目录（无 tool.json，如 shared/），静默跳过
    if (dirExists && !existsSync(join(toolDir, 'tool.json'))) {
      return;
    }

    if (!dirExists) {
      // 工具目录被删除，移除
      this.registry.removeBySourceDir(toolDir);
      ctx.logger.info(t('tools.toolRemovedDirDeleted', { name: toolName }), { dir: toolDir });
      this.notifyToolChanged(ctx, toolName);
      return;
    }

    // 重新加载该工具目录
    const tool = await loadToolFromDir(toolDir, ctx.env, ctx.logger, source);
    if (!tool) {
      // 加载失败（如 tool.json 无效），移除旧的
      this.registry.removeBySourceDir(toolDir);
      ctx.logger.warn(t('tools.reloadFailedRemoved', { name: toolName }), { dir: toolDir });
      this.notifyToolChanged(ctx, toolName);
      return;
    }

    // 自定义工具不允许覆盖内置工具
    if (source === 'custom' && BUILTIN_TOOL_NAMES.has(tool.name)) {
      this.registry.removeBySourceDir(toolDir);
      ctx.logger.warn(t('tools.customConflictsBuiltinRemoved', { name: tool.name }), { dir: toolDir });
      this.notifyToolChanged(ctx, tool.name);
      return;
    }

    // 注册（含 disabled 工具）：启用状态由 registry.isEnabled 实时读取 config
    this.registry.reloadBySourceDir(toolDir, tool);
    ctx.logger.info(t('tools.toolReloaded', { name: tool.name }), { dir: toolDir });
    this.notifyToolChanged(ctx, tool.name);

    // 如果是内置工具热重载，同步更新 loadedBuiltinTools 缓存
    if (source === 'builtin') {
      const idx = this.loadedBuiltinTools.findIndex(t => t.sourceDir === toolDir);
      if (idx >= 0) {
        this.loadedBuiltinTools[idx] = tool;
      } else {
        this.loadedBuiltinTools.push(tool);
      }
    }
  }

  /** 工具热重载后广播变更事件，通知前端刷新工具列表 */
  private notifyToolChanged(ctx: ModuleContext, name: string): void {
    void ctx.eventBus.broadcast('resources:changed', { kind: 'tool', name });
  }

  /** 全量重载某个来源的所有工具（回退方案） */
  private async fullReload(rootDir: string, ctx: ModuleContext, source: 'builtin' | 'custom'): Promise<void> {
    if (!this.registry) return;

    if (source === 'builtin') {
      // 移除所有内置工具
      for (const tool of this.registry.list()) {
        if (tool.source === 'builtin') {
          this.registry.removeBySourceDir(tool.sourceDir!);
        }
      }
      // 重新加载
      this.loadedBuiltinTools = await loadToolsFromDir(rootDir, ctx.env, ctx.logger, 'builtin');
      for (const tool of this.loadedBuiltinTools) {
        this.registry.register(tool);
      }
      ctx.logger.info(t('tools.builtinFullReloaded'));
      this.notifyToolChanged(ctx, '*');
    } else {
      // 移除所有自定义工具
      for (const tool of this.registry.list()) {
        if (tool.source === 'custom') {
          this.registry.removeBySourceDir(tool.sourceDir!);
        }
      }
      await this.loadCustomToolsFromDir(rootDir, ctx);
      ctx.logger.info(t('tools.customFullReloaded'));
      this.notifyToolChanged(ctx, '*');
    }
  }

  async destroy(): Promise<void> {
    this.builtinWatcher?.close();
    this.customWatcher?.close();
  }
}

export default (): Module => new ToolsModule();
