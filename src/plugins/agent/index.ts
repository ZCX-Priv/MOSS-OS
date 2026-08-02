// src/plugins/agent/index.ts
// Agent 引擎插件入口：注册 AgentEngine 服务。

import type { Plugin, PluginContext, PluginMetadata } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { AgentEngineImpl } from './engine';

class AgentPlugin implements Plugin {
  metadata: PluginMetadata = {
    name: 'agent',
    version: '1.0.0',
    description: 'Agent ReAct engine: LLM + tool loop',
    dependencies: {
      llm: '^1.0.0',
      tools: '^1.0.0',
    },
  };

  async initialize(ctx: PluginContext): Promise<void> {
    const engine = new AgentEngineImpl({
      services: ctx.services,
      config: ctx.config,
      eventBus: ctx.eventBus,
      logger: ctx.logger,
      env: ctx.env,
    });
    ctx.services.register(ServiceNames.AGENT_ENGINE, engine, { scope: 'agent' });

    const cfg = ctx.config.getAppConfig().agent;
    ctx.logger.info('Agent plugin initialized', {
      defaultModel: cfg.defaultModel,
      maxTurns: cfg.maxTurns,
      maxTokens: cfg.maxTokens,
    });
  }
}

export default new AgentPlugin();
