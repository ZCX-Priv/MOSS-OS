// src/plugins/tools/registry.ts
// 工具注册表：注册、查询、执行工具。

import type { Logger, ConfigService } from '../../core/types';
import type { Tool, ToolContext, ToolResult } from './types';
import type { ToolRegistry } from '../contracts';

export class ToolRegistryImpl implements ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly logger: Logger;
  private readonly config: ConfigService | null;

  constructor(logger: Logger, config?: ConfigService) {
    this.logger = logger;
    this.config = config ?? null;
  }

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool "${tool.name}" already registered, overriding`);
    }
    this.tools.set(tool.name, tool);
    this.logger.debug(`Tool registered: ${tool.name}`);
  }

  unregister(name: string): void {
    if (!this.tools.delete(name)) {
      this.logger.warn(`Tool "${name}" not registered, cannot unregister`);
    }
  }

  get(name: string): Tool | null {
    return this.tools.get(name) ?? null;
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  listSchemas(): Array<{
    name: string;
    description: string;
    inputSchema: unknown;
    annotations?: Record<string, unknown>;
  }> {
    return this.list().map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations as Record<string, unknown> | undefined,
    }));
  }

  async execute(name: string, params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Error: Tool "${name}" not found` }],
        isError: true,
      };
    }

    // 从 config 读取 requireConfirmation（优先级：config > annotations）
    // config 不可用时回退到工具自身 annotations
    let requireConfirmation = tool.annotations?.requireConfirmation ?? false;
    let toolConfig: Record<string, unknown> | undefined;
    if (this.config) {
      try {
        const allTools = this.config.getAppConfig().tools as Record<string, Record<string, unknown>>;
        toolConfig = allTools[name];
        if (toolConfig && typeof toolConfig.requireConfirmation === 'boolean') {
          requireConfirmation = toolConfig.requireConfirmation;
        }
      } catch {
        // config 不可用时回退到 annotations
      }
    }

    try {
      // 权限确认 hook（通过 ctx.emit 上报，由前端/上层确认）
      if (requireConfirmation) {
        ctx.emit({
          type: 'confirm-required',
          message: `Tool "${name}" requires confirmation`,
          details: params,
        });
      }

      // 注入 toolConfig 到 ctx，供工具自身读取（如 shell 的 timeout）
      const ctxWithConfig: ToolContext = { ...ctx, toolConfig };
      const result = await tool.execute(params, ctxWithConfig);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Tool "${name}" execution failed`, { error: msg });
      return {
        content: [{ type: 'text', text: `Error executing tool "${name}": ${msg}` }],
        isError: true,
      };
    }
  }
}
