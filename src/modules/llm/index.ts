// src/modules/llm/index.ts
// LLM 适配模组入口：注册 LLMRouter 服务。
// 清单来自 module.json，由 ExtensionManager 注入 manifest。

import { t } from '../../core/i18n';
import type { Module, ModuleContext, ModuleManifest } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { LLMRouterImpl } from './router';

class LLMModule implements Module {
  manifest!: ModuleManifest; // 由管理器注入

  async initialize(ctx: ModuleContext): Promise<void> {
    const router = new LLMRouterImpl(ctx.config, ctx.eventBus, ctx.logger);
    ctx.services.register(ServiceNames.LLM_ROUTER, router, {
      scope: 'llm',
      registrantType: 'module',
    });

    const apiCfg = ctx.config.getApiConfig();
    ctx.logger.info(t('llm.moduleInitialized'), {
      modelCount: apiCfg.models.length,
    });
  }
}

export default (manifest: ModuleManifest): Module => {
  const m = new LLMModule();
  m.manifest = manifest;
  return m;
};
