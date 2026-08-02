// src/modules/tools/index.ts
// Tools 模组入口：注册 ToolRegistry + 内置工具 + SkillRegistry。
// 清单来自 module.json，由 ExtensionManager 注入 manifest。

import type { Module, ModuleContext, ModuleManifest } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { ToolRegistryImpl } from './registry';
import { createSkillRegistry } from './skills';
import { readTool } from './read';
import { writeTool } from './write';
import { editTool } from './edit';
import { shellTool } from './shell';
import { useSkillTool } from './use_skill';
import { useMcpTool } from './use_mcp';
import { listMcpTool } from './list_mcp';

class ToolsModule implements Module {
  manifest!: ModuleManifest; // 由管理器注入

  async initialize(ctx: ModuleContext): Promise<void> {
    const registry = new ToolRegistryImpl(ctx.logger);
    const skillRegistry = createSkillRegistry(ctx.env, ctx.logger);

    // 注册内置工具（根据配置过滤）
    const cfg = ctx.config.getAppConfig().tools;
    const tools = [
      ['read', cfg.read.enabled, readTool],
      ['write', cfg.write.enabled, writeTool],
      ['edit', cfg.edit.enabled, editTool],
      ['shell', cfg.shell.enabled, shellTool],
      ['use_skill', cfg.use_skill.enabled, useSkillTool],
      ['use_mcp', cfg.use_mcp.enabled, useMcpTool],
      ['list_mcp', cfg.list_mcp.enabled, listMcpTool],
    ] as const;

    let registered = 0;
    for (const [name, enabled, tool] of tools) {
      if (enabled) {
        registry.register(tool);
        registered++;
      } else {
        ctx.logger.debug(`Tool "${name}" disabled by config`);
      }
    }

    // 注册服务（受保护服务名，由模组注册）
    ctx.services.register(ServiceNames.TOOL_REGISTRY, registry, {
      scope: 'tools',
      registrantType: 'module',
    });
    ctx.services.register(ServiceNames.SKILL_REGISTRY, skillRegistry, {
      scope: 'tools',
      registrantType: 'module',
    });

    ctx.logger.info('Tools module initialized', { tools: registered });
  }
}

export default (manifest: ModuleManifest): Module => {
  const m = new ToolsModule();
  m.manifest = manifest;
  return m;
};
