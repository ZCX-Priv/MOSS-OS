// src/modules/agent/index.ts
// Agent 引擎模组入口：注册 AgentEngine 服务。
// 清单来自 module.json，由 ExtensionManager 注入 manifest。

import { t } from '../../core/i18n';
import type { Module, ModuleContext, ModuleManifest } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { AgentEngineImpl } from './engine';

class AgentModule implements Module {
  manifest!: ModuleManifest; // 由管理器注入

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
      registrantType: 'module',
    });

    const cfg = ctx.config.getAppConfig().agent;
    ctx.logger.info(t('agent.moduleInitialized'), {
      defaultModel: cfg.defaultModel,
      maxTurns: cfg.maxTurns,
      maxTokens: cfg.maxTokens,
    });
  }
}

export default (manifest: ModuleManifest): Module => {
  const m = new AgentModule();
  m.manifest = manifest;
  return m;
};
