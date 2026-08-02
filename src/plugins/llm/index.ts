// src/plugins/llm/index.ts
// LLM 适配插件入口：注册 LLMRouter 服务。

import type { Plugin, PluginContext, PluginMetadata } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { LLMRouterImpl } from './router';

class LLMPlugin implements Plugin {
  metadata: PluginMetadata = {
    name: 'llm',
    version: '1.0.0',
    description: 'LLM adapter plugin: openai-chat, openai-responses, anthropic, gemini',
    dependencies: {},
  };

  async initialize(ctx: PluginContext): Promise<void> {
    const router = new LLMRouterImpl(ctx.config, ctx.eventBus, ctx.logger);
    ctx.services.register(ServiceNames.LLM_ROUTER, router, { scope: 'llm' });

    const apiCfg = ctx.config.getApiConfig();
    ctx.logger.info('LLM plugin initialized', {
      providers: Object.keys(apiCfg.providers),
      defaultProvider: apiCfg.defaultProvider,
    });
  }
}

export default new LLMPlugin();
