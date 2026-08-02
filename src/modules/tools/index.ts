// src/plugins/tools/index.ts
// Tools 插件入口：注册 ToolRegistry + 内置工具 + SkillRegistry。

import type { Plugin, PluginContext, PluginMetadata } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { ToolRegistryImpl } from './registry';
import { createSkillRegistry, SKILL_REGISTRY_SERVICE } from './skills';
import { readTool } from './read';
import { writeTool } from './write';
import { editTool } from './edit';
import { shellTool } from './shell';
import { useSkillTool } from './use_skill';
import { useMcpTool } from './use_mcp';
import { listMcpTool } from './list_mcp';

class ToolsPlugin implements Plugin {
  metadata: PluginMetadata = {
    name: 'tools',
    version: '1.0.0',
    description: 'Built-in tools: read, write, edit, shell, use_skill, use_mcp, list_mcp',
    dependencies: {},
  };

  async initialize(ctx: PluginContext): Promise<void> {
    const registry = new ToolRegistryImpl(ctx.logger);
    const skillRegistry = createSkillRegistry();

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

    // 注册服务
    ctx.services.register(ServiceNames.TOOL_REGISTRY, registry, { scope: 'tools' });
    ctx.services.register(SKILL_REGISTRY_SERVICE, skillRegistry, { scope: 'tools' });

    ctx.logger.info('Tools plugin initialized', { tools: registered });
  }
}

export default new ToolsPlugin();
