// src/modules/llm/index.ts
// LLM 适配模块入口：注册 LLMRouter 服务。

import { t } from '../../core/i18n';
import type { Module, ModuleContext } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { LLMRouterImpl } from './router';

class LLMModule implements Module {

  async initialize(ctx: ModuleContext): Promise<void> {
    const router = new LLMRouterImpl(ctx.config, ctx.eventBus, ctx.logger);
    ctx.services.register(ServiceNames.LLM_ROUTER, router, {
      scope: 'llm',
    });

    const apiCfg = ctx.config.getApiConfig();
    ctx.logger.info(t('llm.moduleInitialized'), {
      modelCount: apiCfg.models.length,
    });
  }
}

export default (): Module => new LLMModule();
