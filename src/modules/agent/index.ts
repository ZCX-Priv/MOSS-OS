// src/modules/agent/index.ts
// Agent 引擎模块入口：注册 AgentEngine 服务。

import { t } from '../../core/i18n';
import type { Module, ModuleContext } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { AgentEngineImpl } from './engine';

class AgentModule implements Module {
  private engine: AgentEngineImpl | null = null;

  async initialize(ctx: ModuleContext): Promise<void> {
    this.engine = new AgentEngineImpl({
      services: ctx.services,
      config: ctx.config,
      eventBus: ctx.eventBus,
      logger: ctx.logger,
      env: ctx.env,
    });
    ctx.services.register(ServiceNames.AGENT_ENGINE, this.engine, {
      scope: 'agent',
    });

    const cfg = ctx.config.getAppConfig().agent;
    ctx.logger.info(t('agent.moduleInitialized'), {
      defaultModel: cfg.defaultModel,
      maxTurns: cfg.maxTurns,
      maxTokens: cfg.maxTokens,
    });
  }

  async destroy(): Promise<void> {
    // 取消 filesys 事件订阅（由 engine.dispose 统一处理）
    this.engine?.dispose();
    this.engine = null;
  }
}

export default (): Module => new AgentModule();
