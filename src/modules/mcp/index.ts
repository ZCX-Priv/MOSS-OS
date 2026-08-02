// src/modules/mcp/index.ts
// MCP Client 模组入口：注册 MCPManager 服务。
// 清单来自 module.json，由 ExtensionManager 注入 manifest。

import type { Module, ModuleContext, ModuleManifest } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { MCPManagerImpl } from './manager';

class McpModule implements Module {
  manifest!: ModuleManifest; // 由管理器注入

  private manager: MCPManagerImpl | null = null;

  async initialize(ctx: ModuleContext): Promise<void> {
    this.manager = new MCPManagerImpl({
      config: ctx.config,
      eventBus: ctx.eventBus,
      logger: ctx.logger,
      env: ctx.env,
    });
    ctx.services.register(ServiceNames.MCP_MANAGER, this.manager, {
      scope: 'mcp',
      registrantType: 'module',
    });

    // 初始化连接（非阻塞，避免单个 MCP 服务器慢导致模组加载超时）
    this.manager.initialize().catch(err => {
      ctx.logger.error('MCP manager initialization failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // 监听配置变更，重载 MCP 服务器
    ctx.config.onChange((_which) => {
      this.manager?.reloadAll().catch(err => {
        ctx.logger.error('MCP reload failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });

    ctx.logger.info('MCP module initialized');
  }

  async destroy(): Promise<void> {
    if (this.manager) {
      await this.manager.shutdown();
    }
  }
}

export default (manifest: ModuleManifest): Module => {
  const m = new McpModule();
  m.manifest = manifest;
  return m;
};
