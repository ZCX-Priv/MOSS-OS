// src/modules/safety/index.ts
// 安全（safety）模块统一导出：所有工具执行的唯一权限决策入口。

import type { Module, ModuleContext } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { SafetyService } from './service';

export type {
  PermissionMode,
  RiskClass,
  SafetyAction,
  SafetyDecision,
  DecisionReason,
  SafetyRules,
  SafetyConfig,
  SafetyRequest,
} from './types';
export { parseRule, serializeRule, escapeRuleContent, unescapeRuleContent } from './parser';
export type { ParsedRule } from './parser';
export { matchRule, isCompoundCommand, splitCommandSegments, extractTargetPaths } from './rules';
export { matchDangerousCommand, matchProtectedPath, isHardProtectedPath } from './patterns';
export type { DangerLevel, DangerousPattern } from './patterns';
export { evaluate, classifyRisk, normalizeMode } from './policy';
export type { PolicyEnv } from './policy';
export { SafetyService } from './service';

class SafetyModule implements Module {
  async initialize(ctx: ModuleContext): Promise<void> {
    const service = new SafetyService(ctx.logger, ctx.config, ctx.env);
    ctx.services.register(ServiceNames.SAFETY, service, { scope: 'safety' });
    ctx.logger.info('[safety] module initialized', { defaultMode: service.getDefaultMode() });
  }
}

export default (): Module => new SafetyModule();
