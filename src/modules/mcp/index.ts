// src/modules/mcp/index.ts
// MCP Client 模块入口：注册 MCPManager 服务。

import { t } from '../../core/i18n';
import type { Module, ModuleContext } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { MCPManagerImpl } from './manager';

class McpModule implements Module {

  private manager: MCPManagerImpl | null = null;

  async initialize(ctx: ModuleContext): Promise<void> {
    this.manager = new MCPManagerImpl({
      config: ctx.config,
      eventBus: ctx.eventBus,
      logger: ctx.logger,
      env: ctx.env,
      services: ctx.services,
    });
    ctx.services.register(ServiceNames.MCP_MANAGER, this.manager, {
      scope: 'mcp',
    });

    // 初始化连接（非阻塞，避免单个 MCP 服务器慢导致模块加载超时）
    this.manager.initialize().catch(err => {
      ctx.logger.error(t('mcp.managerInitFailed'), {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // 监听配置变更，重载 MCP 服务器。
    // 仅响应 app（config.json）：MCP 服务器定义只存在于 config.json 与 mcps/*.json；
    // api.json 仅含 LLM providers，与 MCP 无关，避免无关变更触发全量重连。
    ctx.config.onChange((which) => {
      if (which !== 'app') return;
      this.manager?.reloadAll().catch(err => {
        ctx.logger.error(t('mcp.reloadFailed'), {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });

    ctx.logger.info(t('mcp.moduleInitialized'));
  }

  async destroy(): Promise<void> {
    if (this.manager) {
      await this.manager.shutdown();
    }
  }
}

export default (): Module => new McpModule();
