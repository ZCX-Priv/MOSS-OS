// src/modules/agent/index.ts
// Agent 引擎模块入口：注册 AgentEngine 服务。

import { t } from '../../core/i18n';
import type { Module, ModuleContext } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { AgentEngineImpl } from './engine';

class AgentModule implements Module {

  async initialize(ctx: ModuleContext): Promise<void> {
    const engine = new AgentEngineImpl({
      services: ctx.services,
      config: ctx.config,
      eventBus: ctx.eventBus,
      logger: ctx.logger,
      env: ctx.env,
    });
    ctx.services.register(ServiceNames.AGENT_ENGINE, engine, {
      scope: 'agent',
    });

    const cfg = ctx.config.getAppConfig().agent;
    ctx.logger.info(t('agent.moduleInitialized'), {
      defaultModel: cfg.defaultModel,
      maxTurns: cfg.maxTurns,
      maxTokens: cfg.maxTokens,
    });
  }
}

export default (): Module => new AgentModule();
