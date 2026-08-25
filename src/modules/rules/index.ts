// src/modules/rules/index.ts
// 规则引擎模块入口：注册 RULES_ENGINE 服务（基础设施级，先于 context/agent 初始化）。
// 职责：用户自定义行为规则（哈希 JSON 存储）、always/paths 双加载、
// always 段注入系统提示、paths 规则文件访问触发注入会话锚定消息。

import type { Module, ModuleContext } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { RulesEngineServiceImpl } from './service';

class RulesModule implements Module {
  private engine: RulesEngineServiceImpl | null = null;

  async initialize(ctx: ModuleContext): Promise<void> {
    this.engine = new RulesEngineServiceImpl({
      env: ctx.env,
      config: ctx.config,
      logger: ctx.logger,
    });
    ctx.services.register(ServiceNames.RULES_ENGINE, this.engine, {
      scope: 'rules',
    });
    ctx.logger.info('rules: engine initialized', {
      enabled: this.engine.getConfig().enabled,
    });
  }

  async destroy(): Promise<void> {
    this.engine = null;
  }
}

export default (): Module => new RulesModule();

// 公共导出（context / agent / server 模块使用）
export { RulesEngineServiceImpl } from './service';
export type { RulesEngineServiceDeps } from './service';
export type {
  RuleRecord,
  RuleScope,
  RuleLoadMode,
  RuleUpsertInput,
  ScopedRuleRecord,
  CompiledRuleSet,
} from './types';
export { ACTIVE_RULES_MSG_NAME, USER_RULES_SECTION_ID } from './inject';
export { computeRuleId } from './storage';
