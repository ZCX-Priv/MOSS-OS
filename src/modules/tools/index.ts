// src/modules/tools/index.ts
// Tools 模组入口：注册 ToolRegistry + 内置工具 + SkillRegistry。
// 工具清单从 manifest.ts / builtin.ts 自动派生，新增工具无需修改注册逻辑。
// 支持配置热重载（enabled 变更即时生效）和自定义工具动态加载（~/.moss/tools/）。

import type { Module, ModuleContext, ModuleManifest } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { join } from 'node:path';
import { existsSync, readdirSync, watch } from 'node:fs';
import { ToolRegistryImpl } from './registry';
import { createSkillRegistry } from './skills';
import { createSpecRegistry } from './specs';
import { BUILTIN_TOOLS } from './builtin';
import { BUILTIN_TOOL_NAMES } from './manifest';
import type { Tool } from './types';

class ToolsModule implements Module {
  manifest!: ModuleManifest;

  private registry: ToolRegistryImpl | null = null;
  private ctx: ModuleContext | null = null;
  private customToolWatcher?: ReturnType<typeof watch>;

  async initialize(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;
    this.registry = new ToolRegistryImpl(ctx.logger, ctx.config);
    const skillRegistry = createSkillRegistry(ctx.env, ctx.logger);
    const specRegistry = createSpecRegistry(ctx.env, ctx.logger);

    // 1. 注册内置工具（从 manifest 驱动）
    this.registerBuiltinTools(ctx);

    // 2. 加载自定义工具（~/.moss/tools/）
    await this.loadCustomTools(ctx);

    // 3. 注册服务（受保护服务名，由模组注册）
    ctx.services.register(ServiceNames.TOOL_REGISTRY, this.registry, {
      scope: 'tools',
      registrantType: 'module',
    });
    ctx.services.register(ServiceNames.SKILL_REGISTRY, skillRegistry, {
      scope: 'tools',
      registrantType: 'module',
    });
    ctx.services.register(ServiceNames.SPEC_REGISTRY, specRegistry, {
      scope: 'tools',
      registrantType: 'module',
    });

    // 4. 热重载：配置变更时增删工具
    ctx.config.onChange((which) => {
      if (which !== 'app') return;
      this.syncToolsWithConfig().catch(err => {
        ctx.logger.error('Tools hot reload failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });

    ctx.logger.info('Tools module initialized', {
      tools: this.registry.list().length,
    });
  }

  /** 从 manifest 驱动注册内置工具（根据 config 过滤） */
  private registerBuiltinTools(ctx: ModuleContext): void {
    const cfg = ctx.config.getAppConfig().tools as Record<string, { enabled?: boolean }>;
    for (const entry of BUILTIN_TOOLS) {
      const enabled = cfg[entry.name]?.enabled ?? true;
      if (enabled) {
        this.registry!.register(entry.factory(ctx.env));
      } else {
        ctx.logger.debug(`Tool "${entry.name}" disabled by config`);
      }
    }
  }

  /** 热重载：diff 已注册工具与新配置，动态增删 */
  private async syncToolsWithConfig(): Promise<void> {
    if (!this.registry || !this.ctx) return;
    const cfg = this.ctx.config.getAppConfig().tools as Record<string, { enabled?: boolean }>;
    for (const entry of BUILTIN_TOOLS) {
      const enabled = cfg[entry.name]?.enabled ?? true;
      const registered = this.registry.get(entry.name) !== null;
      if (enabled && !registered) {
        this.registry.register(entry.factory(this.ctx.env));
        this.ctx.logger.info(`Tool "${entry.name}" hot-enabled`);
      } else if (!enabled && registered) {
        this.registry.unregister(entry.name);
        this.ctx.logger.info(`Tool "${entry.name}" hot-disabled`);
      }
    }
  }

  /** 从 ~/.moss/tools/ 加载自定义工具（错误隔离，单个失败不影响其他） */
  private async loadCustomTools(ctx: ModuleContext): Promise<void> {
    const dir = join(ctx.env.dataDir, 'tools');
    if (!existsSync(dir)) return;

    ctx.logger.info('Loading custom tools', { dir });
    await this.loadCustomToolsFromDir(dir, ctx);

    // 监听目录变化（防抖 500ms）
    let debounce: ReturnType<typeof setTimeout> | null = null;
    try {
      this.customToolWatcher = watch(dir, { recursive: false }, () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          this.reloadCustomTools(ctx).catch(err => {
            ctx.logger.error('Custom tools reload failed', {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }, 500);
      });
    } catch (err) {
      ctx.logger.warn('Failed to watch custom tools directory', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 扫描目录并加载所有 .ts/.js 工具文件 */
  private async loadCustomToolsFromDir(dir: string, ctx: ModuleContext): Promise<void> {
    let files: string[];
    try {
      files = readdirSync(dir).filter(f => f.endsWith('.ts') || f.endsWith('.js'));
    } catch {
      return;
    }

    for (const file of files) {
      const fullPath = join(dir, file);
      try {
        // 动态 import（Bun 支持直接 import .ts）
        const mod = await import(fullPath);
        const exported = mod.default ?? mod.tool;
        let tool: Tool | null = null;

        if (typeof exported === 'function') {
          tool = exported(ctx.env);
        } else if (exported && typeof exported === 'object') {
          tool = exported as Tool;
        }

        if (!tool || !this.isValidTool(tool)) {
          ctx.logger.warn(`Custom tool file skipped (invalid export): ${file}`);
          continue;
        }

        // 不允许覆盖内置工具
        if (BUILTIN_TOOL_NAMES.has(tool.name)) {
          ctx.logger.warn(`Custom tool "${tool.name}" conflicts with builtin, skipped: ${file}`);
          continue;
        }

        this.registry!.register(tool);
        ctx.logger.info(`Custom tool loaded: ${tool.name}`, { file });
      } catch (err) {
        // 单个工具加载失败不影响其他工具和系统启动
        ctx.logger.error(`Failed to load custom tool: ${file}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /** 重新加载所有自定义工具（先注销旧的，再加载新的） */
  private async reloadCustomTools(ctx: ModuleContext): Promise<void> {
    if (!this.registry) return;
    // 注销所有非内置工具
    for (const tool of this.registry.list()) {
      if (!BUILTIN_TOOL_NAMES.has(tool.name)) {
        this.registry.unregister(tool.name);
      }
    }
    // 重新加载
    const dir = join(ctx.env.dataDir, 'tools');
    await this.loadCustomToolsFromDir(dir, ctx);
    ctx.logger.info('Custom tools reloaded');
  }

  /** 校验导出是否符合 Tool 接口 */
  private isValidTool(obj: unknown): obj is Tool {
    if (!obj || typeof obj !== 'object') return false;
    const t = obj as Record<string, unknown>;
    return (
      typeof t.name === 'string' &&
      typeof t.description === 'string' &&
      typeof t.inputSchema === 'object' &&
      typeof t.execute === 'function'
    );
  }

  async destroy(): Promise<void> {
    this.customToolWatcher?.close();
  }
}

export default (manifest: ModuleManifest): Module => {
  const m = new ToolsModule();
  m.manifest = manifest;
  return m;
};
