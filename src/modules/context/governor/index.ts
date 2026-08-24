// src/modules/context/governor/index.ts
// 治理器：每轮 LLM 请求前的统一流水线（engine 调用点）。
//   1. ensureEnvContext（跨天环境追加 / 旧会话补建锚定）
//   2. 构建静态系统提示（skill system 模式注入）
//   3. 预览视图估算 → shouldCompact → 同步执行压缩（唯一防溢出时机）
//   4. 溢出兜底：压缩后仍超窗 → view-builder 尾部裁剪（最后防线）
//   5. 最终视图 + breakdown
// 异常降级：任何环节失败 → 兜底视图（degradedReason 标注），绝不中断主循环。

import type { Environment, Logger, ServiceRegistry } from '../../../core/types';
import { ServiceNames } from '../../../core/types';
import type { LLMRouter } from '../../contracts';
import type {
  CompactionRecord,
  ContextEngineConfig,
  ContextSessionLike,
  PreparedRequest,
} from '../types';
import { buildStaticSystemPrompt, buildRequestView, ensureEnvContext } from '../compiler';
import { ensureProjectContext } from '../file-index/project-context';
import { compactSession, resolveSummaryModel } from '../compressor';
import { estimateTextTokens, estimateMessagesTokens } from '../budgeter/estimator';
import { shouldCompact, needsHardCeiling, compactionActive } from './triggers';

/** SkillRegistry 鸭子类型（避免直接依赖 tools 模块类型） */
interface SkillRegistryLike {
  get(name: string): { prompt: string } | null;
  isEnabled(name: string): boolean;
}

export interface GovernorDeps {
  env: Environment;
  logger: Logger;
  services: ServiceRegistry;
  /** 实时读取上下文引擎配置（热更新） */
  getConfig(): ContextEngineConfig;
  /** 实时读取 LLM Router（延迟解析：llm 模块可能尚未就绪） */
  getLlm(): LLMRouter | null;
  /** 实时读取模型列表（摘要模型解析） */
  getApiModels(): Array<{ id: string; model: string }>;
  /** session 持久化回调（agent 模块 bind 注入） */
  persistSession(session: ContextSessionLike): void;
  /** WS 推送回调 */
  emitWs(sessionId: string, message: unknown): void;
  /** 压缩完成遥测回调 */
  onCompaction(sessionId: string, record: CompactionRecord): void;
  /** 降级遥测回调 */
  onDegraded(sessionId: string, reason: string): void;
  /** 项目概要文本（文件索引模块；图谱/SAG 开启时注入锚定消息，关闭返回 null） */
  getProjectOverview?(cwd: string): Promise<string | null>;
}

export interface PrepareRequestInput {
  session: ContextSessionLike;
  cwd: string;
  /** 主模型请求名（发送给 LLM 的 model 字段值） */
  model: string;
  modelDisplayName: string;
  /** 上下文窗口 token（调用方从模型配置解析） */
  windowTokens: number;
}

/** 解析 skill prompt（SkillRegistry 运行时解析；禁用/缺失返回 null） */
function resolveSkillPromptFromRegistry(
  services: ServiceRegistry,
  skillName: string | undefined,
): string | null {
  if (!skillName) return null;
  const registry = services.tryResolve<SkillRegistryLike>(ServiceNames.SKILL_REGISTRY);
  if (!registry) return null;
  const skill = registry.get(skillName);
  if (!skill || !registry.isEnabled(skillName)) return null;
  return skill.prompt;
}

/**
 * 请求准备流水线。失败降级（degradedReason 标注）而非抛错。
 */
export async function prepareRequest(
  deps: GovernorDeps,
  input: PrepareRequestInput,
): Promise<PreparedRequest> {
  const { session, cwd, model, modelDisplayName, windowTokens } = input;
  const config = deps.getConfig();

  // ===== 1. 环境上下文保障（跨天追加 / 旧会话补建）=====
  try {
    if (ensureEnvContext(session, deps.env, cwd)) {
      deps.persistSession(session);
    }
  } catch (err) {
    deps.logger.warn('context: ensureEnvContext failed', {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ===== 1.5 项目概要锚定（文件索引：图谱/SAG 开启时注入大局观）=====
  if (deps.getProjectOverview && (config.fileIndex.graph.enabled || config.fileIndex.sag.enabled)) {
    try {
      if (await ensureProjectContext(session, () => deps.getProjectOverview!(cwd))) {
        deps.persistSession(session);
      }
    } catch (err) {
      deps.logger.warn('context: ensureProjectContext failed', {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ===== 2. 静态系统提示（skill system 模式注入）=====
  const skillName = session.activeSkill?.mode === 'system' ? session.activeSkill.name : undefined;
  const skillPrompt = resolveSkillPromptFromRegistry(deps.services, skillName);
  const staticSystemPrompt = buildStaticSystemPrompt(
    deps.env,
    cwd,
    model,
    modelDisplayName,
    skillPrompt,
  );

  const resolveSkill = (name: string): string | null =>
    resolveSkillPromptFromRegistry(deps.services, name);

  const buildView = (budgetTokens?: number) =>
    buildRequestView(session, staticSystemPrompt, {
      toolPruning: config.toolPruning,
      resolveSkillPrompt: resolveSkill,
      budgetTokens,
    });

  // ===== 3. 预览估算 → 压缩决策 =====
  let compactionTriggered = false;
  let degradedReason: string | undefined;

  const preview = buildView();
  if (compactionActive(config.compaction, windowTokens)) {
    if (shouldCompact(preview.breakdown.total, windowTokens, config.compaction.compactRatio)) {
      const llm = deps.getLlm();
      if (llm) {
        const { requestModel } = resolveSummaryModel(
          config.compaction.summaryModel,
          model,
          deps.getApiModels(),
        );
        deps.emitWs(session.id, {
          type: 'compaction-started',
          sessionId: session.id,
          payload: { sessionId: session.id, trigger: 'auto' },
        });
        try {
          const outcome = await compactSession(session, {
            env: deps.env,
            config: config.compaction,
            llm,
            logger: deps.logger,
            staticSystemPrompt,
            summaryModelId: requestModel,
            summaryModelConfigured: config.compaction.summaryModel,
            windowTokens,
            trigger: 'auto',
          });
          if (outcome.record) {
            compactionTriggered = true;
            deps.persistSession(session);
            deps.onCompaction(session.id, outcome.record);
            deps.emitWs(session.id, {
              type: 'compaction-completed',
              sessionId: session.id,
              payload: { sessionId: session.id, compaction: outcome.record },
            });
          } else if (outcome.reason) {
            // 区太小/摘要失败：不算降级（下轮再试），仅 debug
            deps.logger.debug('context: auto compaction skipped', {
              sessionId: session.id,
              reason: outcome.reason,
            });
          }
        } catch (err) {
          degradedReason = `compaction threw: ${err instanceof Error ? err.message : String(err)}`;
          deps.onDegraded(session.id, degradedReason);
        }
      } else {
        degradedReason = 'llm router unavailable for compaction';
        deps.onDegraded(session.id, degradedReason);
      }
    }
  }

  // ===== 4. 最终视图（溢出兜底：压缩后仍超窗 → 尾部裁剪）=====
  const final = buildView(
    needsHardCeiling(preview.breakdown.total, windowTokens) || compactionTriggered
      ? windowTokens
      : undefined,
  );

  if (final.tailDropped > 0) {
    degradedReason = degradedReason ?? `hard ceiling: dropped ${final.tailDropped} head messages`;
    deps.onDegraded(session.id, `tail window dropped ${final.tailDropped} messages`);
  }

  return {
    messages: final.messages,
    estimatedTokens: final.breakdown.total,
    windowTokens,
    compactionTriggered,
    breakdown: final.breakdown,
    ...(degradedReason ? { degradedReason } : {}),
  };
}

/**
 * 手动压缩（空闲时）：复用 compactSession，focus 为用户附加焦点。
 */
export async function manualCompact(
  deps: GovernorDeps,
  input: PrepareRequestInput & { focus?: string },
): Promise<{ record: CompactionRecord | null; reason?: string }> {
  const config = deps.getConfig();
  const llm = deps.getLlm();
  if (!llm) return { record: null, reason: 'llm router unavailable' };

  const { requestModel } = resolveSummaryModel(
    config.compaction.summaryModel,
    input.model,
    deps.getApiModels(),
  );

  // 静态系统提示（cache-aligned 摘要前缀）
  const skillName = input.session.activeSkill?.mode === 'system' ? input.session.activeSkill.name : undefined;
  const staticSystemPrompt = buildStaticSystemPrompt(
    deps.env,
    input.cwd,
    input.model,
    input.modelDisplayName,
    resolveSkillPromptFromRegistry(deps.services, skillName),
  );

  deps.emitWs(input.session.id, {
    type: 'compaction-started',
    sessionId: input.session.id,
    payload: { sessionId: input.session.id, trigger: 'manual' },
  });

  const outcome = await compactSession(input.session, {
    env: deps.env,
    config: config.compaction,
    llm,
    logger: deps.logger,
    staticSystemPrompt,
    summaryModelId: requestModel,
    summaryModelConfigured: config.compaction.summaryModel,
    windowTokens: input.windowTokens,
    trigger: 'manual',
    ...(input.focus ? { focus: input.focus } : {}),
  });

  if (outcome.record) {
    deps.persistSession(input.session);
    deps.onCompaction(input.session.id, outcome.record);
    deps.emitWs(input.session.id, {
      type: 'compaction-completed',
      sessionId: input.session.id,
      payload: { sessionId: input.session.id, compaction: outcome.record },
    });
  }
  return outcome;
}

/**
 * 手动压缩预览（确认对话框数据）：估算可压缩区与保留尾部。
 */
export function previewCompact(
  deps: GovernorDeps,
  session: ContextSessionLike,
  windowTokens: number,
): {
  compactableCount: number;
  compactableTokens: number;
  tailKeepCount: number;
  estimatedAfterTokens: number;
} {
  const config = deps.getConfig();
  const active = session.messages.filter(m => !m.deletedAt && !m.compacted);
  // 与 planner 同口径的快速估算：尾部预算之外即视为可压缩区
  let head = 0;
  if (active.length > 0 && active[0].name === 'env-context') head = 1;

  const tailBudget = Math.max(1, Math.floor(windowTokens * config.compaction.tailKeepRatio));
  let start = active.length;
  let acc = 0;
  for (let i = active.length - 1; i > head; i--) {
    const t = estimateTextTokens(active[i].content) + 4;
    if (active.length - i > 2 && acc + t > tailBudget) break;
    acc += t;
    start = i;
  }
  while (start > head && start < active.length && active[start].role === 'tool') start--;

  const region = active.slice(head, start);
  const compactableTokens = estimateMessagesTokens(region);
  const envTokens = head > 0 ? estimateMessagesTokens(active.slice(0, head)) : 0;
  const tailTokens = estimateMessagesTokens(active.slice(start));
  return {
    compactableCount: region.length,
    compactableTokens,
    tailKeepCount: active.length - start,
    estimatedAfterTokens: envTokens + tailTokens + config.compaction.summaryMaxTokens,
  };
}
