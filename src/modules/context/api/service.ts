// src/modules/context/api/service.ts
// ContextEngine 服务实现：整合 governor 流水线、healer 自愈、遥测环形缓冲、
// busy 管理、session store 桥接。注册为 ServiceNames.CONTEXT_ENGINE。
// agent 模块通过 bindSessionStore 注入会话存取回调（依赖方向 agent → context）。

import type {
  ConfigService,
  Environment,
  Logger,
  ServiceRegistry,
} from '../../../core/types';
import { ServiceNames } from '../../../core/types';
import type { LLMRouter, ToolRegistry, MCPManager } from '../../contracts';
import type {
  CacheHitSample,
  CompactPreview,
  CompactionRecord,
  ContextBreakdown,
  ContextEngineConfig,
  ContextSessionLike,
  ContextStats,
  HealResult,
  ManualCompactResult,
  PreparedRequest,
  SessionStoreBridge,
  SystemSection,
} from '../types';
// 注：ContextStatsEventPayload 已删除——部分形状类型合法化了不完整 payload（白屏缺陷共犯）
import { DEFAULT_CONTEXT_CONFIG, TELEMETRY_BUFFER_SIZE as BUFFER_SIZE } from '../types';
import { TokenCalibrator } from '../budgeter/calibration';
import { messagesChars, parseContextWindow } from '../budgeter/estimator';
import { buildStaticSystemPrompt, getSystemSections } from '../compiler';
import { healToolCall, type HealRegistryLike } from '../healer';
import {
  prepareRequest as governorPrepare,
  manualCompact as governorManualCompact,
  previewCompact as governorPreview,
  type GovernorDeps,
} from '../governor';
import { resolveSummaryModel } from '../compressor';
import { ensureContextPrompts } from '../prompt-loader';

/** ToolRegistry 鸭子类型（get/listSchemas） */
interface ToolRegistryLike {
  get(name: string): { name: string; description?: string; inputSchema?: unknown } | null;
  listSchemas(): Array<{ name: string; description: string; inputSchema?: unknown }>;
}

/** MCPManager 鸭子类型（listTools） */
interface McpManagerLike {
  listTools(): Array<{ server: string; name: string; description?: string; inputSchema?: unknown }>;
}

/** 会话级遥测状态 */
interface SessionTelemetry {
  cacheHits: CacheHitSample[];
  lastBreakdown: ContextBreakdown | null;
  lastWindowTokens: number;
  lastSystemSections: SystemSection[];
  lastSentChars: number;
}

export interface ContextEngineServiceDeps {
  env: Environment;
  config: ConfigService;
  services: ServiceRegistry;
  logger: Logger;
}

export interface PrepareRequestOptions {
  cwd: string;
  model: string;
  modelDisplayName: string;
  /** 上下文窗口 token；缺省从模型配置 contextWindow 解析 */
  windowTokens?: number;
}

export class ContextEngineServiceImpl {
  private readonly env: Environment;
  private readonly config: ConfigService;
  private readonly services: ServiceRegistry;
  private readonly logger: Logger;
  private readonly calibrator = new TokenCalibrator();
  private readonly telemetry = new Map<string, SessionTelemetry>();
  private readonly busySessions = new Set<string>();
  private sessionStore: SessionStoreBridge | null = null;

  constructor(deps: ContextEngineServiceDeps) {
    this.env = deps.env;
    this.config = deps.config;
    this.services = deps.services;
    this.logger = deps.logger;
  }

  /** 模块初始化：补充播种 compact/heal 提示词目录 */
  onInitialize(): void {
    ensureContextPrompts(this.env);
    this.logger.info('context: engine initialized', {
      compaction: this.getConfig().compaction.enabled ? 'enabled' : 'disabled',
    });
  }

  /** agent 模块注入会话存取桥（依赖方向 agent → context） */
  bindSessionStore(bridge: SessionStoreBridge): void {
    this.sessionStore = bridge;
  }

  /** 实时读取引擎配置（config:changed 自动生效） */
  getConfig(): ContextEngineConfig {
    const app = this.config.getAppConfig();
    const ctx = (app as { context?: Partial<ContextEngineConfig> }).context;
    if (!ctx) return DEFAULT_CONTEXT_CONFIG;
    return {
      compaction: { ...DEFAULT_CONTEXT_CONFIG.compaction, ...ctx.compaction },
      toolPruning: { ...DEFAULT_CONTEXT_CONFIG.toolPruning, ...ctx.toolPruning },
      healer: { ...DEFAULT_CONTEXT_CONFIG.healer, ...ctx.healer },
      telemetry: { ...DEFAULT_CONTEXT_CONFIG.telemetry, ...ctx.telemetry },
    };
  }

  // ========================================================================
  // 请求准备（governor 流水线）
  // ========================================================================

  /**
   * 每轮 LLM 请求前的统一流水线（engine 调用点）。
   * 同时记录遥测（breakdown/systemSections）供 stats API 与 WS 推送。
   */
  async prepareRequest(
    session: ContextSessionLike,
    opts: PrepareRequestOptions,
  ): Promise<PreparedRequest> {
    const windowTokens = opts.windowTokens ?? this.resolveWindowTokens(opts.model);
    this.noteCwd(opts.cwd);
    const deps = this.buildGovernorDeps();
    const prepared = await governorPrepare(deps, {
      session,
      cwd: opts.cwd,
      model: opts.model,
      modelDisplayName: opts.modelDisplayName,
      windowTokens,
    });

    // 遥测：breakdown + systemSections + 发送字符数（校准口径）
    const skillName = session.activeSkill?.mode === 'system' ? session.activeSkill.name : undefined;
    const sections = getSystemSections(
      this.env,
      opts.cwd,
      opts.model,
      opts.modelDisplayName,
      skillName,
      name => this.resolveSkillPrompt(name),
    );
    const sentChars = messagesChars(
      prepared.messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId !== undefined ? { toolCallId: m.toolCallId } : {}),
        ...(m.name !== undefined ? { name: m.name } : {}),
        ...(m.toolCalls
          ? {
              toolCalls: m.toolCalls.map(tc => ({
                id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments,
              })),
            }
          : {}),
      })),
    );
    const t = this.ensureTelemetry(session.id);
    t.lastBreakdown = prepared.breakdown;
    t.lastWindowTokens = windowTokens;
    t.lastSystemSections = sections;
    t.lastSentChars = sentChars;

    return prepared;
  }

  /** 静态系统提示词构建（agent fallback / 路由复用） */
  buildSystemPrompt(
    cwd: string,
    model: string,
    modelDisplayName: string,
    skillPrompt?: string | null,
  ): string {
    return buildStaticSystemPrompt(this.env, cwd, model, modelDisplayName, skillPrompt);
  }

  // ========================================================================
  // 自愈（healer 入口）
  // ========================================================================

  /** 工具调用自愈：参数修复 → 工具名纠正 → schema 校验修正 */
  healToolCall(toolName: string, args: string): HealResult {
    const config = this.getConfig().healer;
    const registry = this.buildHealRegistry();
    return healToolCall({
      toolName,
      arguments: args,
      registry,
      config,
      env: this.env,
    });
  }

  /** 组合 ToolRegistry + MCP 工具为 healer 可用的注册表视图 */
  private buildHealRegistry(): HealRegistryLike {
    const toolRegistry = this.services.tryResolve<ToolRegistryLike>(ServiceNames.TOOL_REGISTRY);
    const mcpManager = this.services.tryResolve<McpManagerLike>(ServiceNames.MCP_MANAGER);
    let mcpTools: Array<{ server: string; name: string; description?: string; inputSchema?: unknown }> = [];
    try {
      mcpTools = mcpManager?.listTools() ?? [];
    } catch {
      mcpTools = [];
    }

    return {
      get: (name: string) => {
        const mcpMatch = /^mcp__([^_]+)__(.+)$/.exec(name);
        if (mcpMatch) {
          const t = mcpTools.find(x => x.server === mcpMatch[1] && x.name === mcpMatch[2]);
          return t ? { name, description: t.description, inputSchema: t.inputSchema } : null;
        }
        const t = toolRegistry?.get(name);
        return t ? { name: t.name, description: t.description, inputSchema: t.inputSchema } : null;
      },
      listSchemas: () => {
        const builtin = toolRegistry
          ? toolRegistry.listSchemas().map(s => ({
              name: s.name,
              description: s.description,
              inputSchema: s.inputSchema,
            }))
          : [];
        const mcp = mcpTools.map(t => ({
          name: `mcp__${t.server}__${t.name}`,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        return [...builtin, ...mcp];
      },
    };
  }

  // ========================================================================
  // 手动压缩
  // ========================================================================

  markBusy(sessionId: string): void {
    this.busySessions.add(sessionId);
  }

  markIdle(sessionId: string): void {
    this.busySessions.delete(sessionId);
  }

  /** 手动压缩（空闲时可用） */
  async manualCompact(sessionId: string, focus?: string): Promise<ManualCompactResult> {
    const session = this.sessionStore?.get(sessionId);
    if (!session) return { ok: false, reason: 'session not found' };
    if (this.busySessions.has(sessionId)) {
      return { ok: false, reason: 'session is running; compaction is only available when idle' };
    }
    const model = this.resolveMainModel();
    const windowTokens = this.resolveWindowTokens(model);
    const deps = this.buildGovernorDeps();
    this.markBusy(sessionId);
    try {
      const outcome = await governorManualCompact(deps, {
        session,
        cwd: this.lastCwd ?? process.cwd(),
        model,
        modelDisplayName: model,
        windowTokens,
        ...(focus !== undefined ? { focus } : {}),
      });
      return outcome.record
        ? { ok: true, compaction: outcome.record }
        : { ok: false, reason: outcome.reason ?? 'compaction not applicable' };
    } finally {
      this.markIdle(sessionId);
    }
  }

  /** 手动压缩预览（确认对话框数据） */
  previewCompact(sessionId: string): CompactPreview | null {
    const session = this.sessionStore?.get(sessionId);
    if (!session) return null;
    const model = this.resolveMainModel();
    const windowTokens = this.resolveWindowTokens(model);
    const deps = this.buildGovernorDeps();
    const est = governorPreview(deps, session, windowTokens);
    return {
      sessionId,
      compactableCount: est.compactableCount,
      compactableTokens: est.compactableTokens,
      tailKeepCount: est.tailKeepCount,
      estimatedAfterTokens: est.estimatedAfterTokens,
    };
  }

  // ========================================================================
  // 统计与遥测
  // ========================================================================

  /** 获取会话上下文统计（token 构成/缓存命中/压缩状态/系统上下文分段） */
  getStats(sessionId: string): ContextStats | null {
    const session = this.sessionStore?.get(sessionId);
    if (!session) return null;
    const t = this.ensureTelemetry(sessionId);
    const config = this.getConfig();
    const breakdown =
      t.lastBreakdown ??
      ({ system: 0, env: 0, summary: 0, history: 0, total: 0 } as ContextBreakdown);
    const windowTokens = t.lastWindowTokens || this.resolveWindowTokens(this.resolveMainModel());
    const compactedMessages = session.messages.filter(m => m.compacted).length;
    const activeSummary = session.messages.find(
      m => m.name === 'compaction-summary' && !m.compacted && !m.deletedAt,
    );
    const summaryTokens = activeSummary ? Math.ceil(activeSummary.content.length * 0.4) : 0;
    const avgHitRate =
      t.cacheHits.length > 0
        ? t.cacheHits.reduce((s, x) => s + x.hitRate, 0) / t.cacheHits.length
        : null;

    return {
      sessionId,
      breakdown,
      windowTokens,
      usedPercent: windowTokens > 0 ? Math.round((breakdown.total / windowTokens) * 100) : 0,
      compaction: {
        enabled: config.compaction.enabled,
        compactRatio: config.compaction.compactRatio,
        compactedMessages,
        activeSummaryTokens: summaryTokens,
        ...(session.compactions && session.compactions.length > 0
          ? { lastCompaction: session.compactions[session.compactions.length - 1] }
          : {}),
      },
      cacheHits: [...t.cacheHits],
      avgHitRate,
      systemSections: t.lastSystemSections,
    };
  }

  /** 压缩历史 */
  getCompactions(sessionId: string): CompactionRecord[] {
    const session = this.sessionStore?.get(sessionId);
    return session?.compactions ? [...session.compactions] : [];
  }

  /** engine 每轮流结束后上报 usage（缓存命中采样 + tokPerChar 校准） */
  onTurnUsage(sessionId: string, usage: { promptTokens: number; cachedTokens: number }): void {
    const t = this.ensureTelemetry(sessionId);
    const promptTokens = Math.max(0, usage.promptTokens);
    const cachedTokens = Math.max(0, Math.min(usage.cachedTokens, promptTokens));
    const hitRate = promptTokens > 0 ? cachedTokens / promptTokens : 0;
    t.cacheHits.push({
      at: new Date().toISOString(),
      promptTokens,
      cachedTokens,
      hitRate,
    });
    if (t.cacheHits.length > BUFFER_SIZE) {
      t.cacheHits.splice(0, t.cacheHits.length - BUFFER_SIZE);
    }
    // tokPerChar 校准（chars 口径：最近一次发送内容）
    this.calibrator.calibrate(promptTokens, t.lastSentChars);

    // WS 推送实时命中（完整统计：与 onCompaction / stats API 同一数据源 getStats，
    // 避免部分形状 payload 覆盖前端 store 导致渲染崩溃——白屏缺陷根治点）
    const stats = this.getStats(sessionId);
    if (stats) {
      this.emitWs(sessionId, { type: 'context-stats-updated', sessionId, payload: stats });
    }
  }

  /** 校准器（遥测/调试用） */
  getCalibrator(): TokenCalibrator {
    return this.calibrator;
  }

  /** 摘要模型可选列表（设置页数据源） */
  getSummaryModels(): Array<{ id: string; name: string; model: string }> {
    return this.config.getApiConfig().models.map(m => ({ id: m.id, name: m.name, model: m.model }));
  }

  // ========================================================================
  // 内部辅助
  // ========================================================================

  /** 最近一次 prepareRequest 的 cwd（手动压缩摘要前缀复用） */
  private lastCwd: string | null = null;

  private buildGovernorDeps(): GovernorDeps {
    return {
      env: this.env,
      logger: this.logger,
      services: this.services,
      getConfig: () => this.getConfig(),
      getLlm: () => this.services.tryResolve<LLMRouter>(ServiceNames.LLM_ROUTER),
      getApiModels: () =>
        this.config.getApiConfig().models.map(m => ({ id: m.id, model: m.model })),
      persistSession: session => this.sessionStore?.persist(session),
      emitWs: (sessionId, message) => this.emitWs(sessionId, message),
      onCompaction: sessionId => {
        // 压缩后立即刷新 stats 推送
        const stats = this.getStats(sessionId);
        if (stats) {
          this.emitWs(sessionId, {
            type: 'context-stats-updated',
            sessionId,
            payload: {
              sessionId,
              breakdown: stats.breakdown,
              windowTokens: stats.windowTokens,
              usedPercent: stats.usedPercent,
              avgHitRate: stats.avgHitRate,
            },
          });
        }
      },
      onDegraded: (sessionId, reason) => {
        this.logger.warn('context: degraded', { sessionId, reason });
        this.emitWs(sessionId, {
          type: 'context-degraded',
          sessionId,
          payload: { sessionId, reason },
        });
      },
    };
  }

  /** prepareRequest 时同步 lastCwd */
  noteCwd(cwd: string): void {
    this.lastCwd = cwd;
  }

  private emitWs(sessionId: string, message: unknown): void {
    const server = this.services.tryResolve<{
      sendToSession: (sid: string, msg: unknown) => void;
    }>(ServiceNames.SERVER_INSTANCE);
    try {
      server?.sendToSession(sessionId, message);
    } catch {
      // server 未就绪/连接已关：静默
    }
  }

  private ensureTelemetry(sessionId: string): SessionTelemetry {
    let t = this.telemetry.get(sessionId);
    if (!t) {
      t = {
        cacheHits: [],
        lastBreakdown: null,
        lastWindowTokens: 0,
        lastSystemSections: [],
        lastSentChars: 0,
      };
      this.telemetry.set(sessionId, t);
    }
    return t;
  }

  /** 解析主模型请求名（agent.defaultModel） */
  private resolveMainModel(): string {
    try {
      return this.config.getAppConfig().agent.defaultModel || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /** 从模型配置解析上下文窗口 */
  private resolveWindowTokens(model: string): number {
    try {
      const models = this.config.getApiConfig().models;
      const found = models.find(m => m.id === model || m.model === model);
      return parseContextWindow(found?.contextWindow);
    } catch {
      return parseContextWindow(undefined);
    }
  }

  private resolveSkillPrompt(name: string): string | null {
    const registry = this.services.tryResolve<{
      get(n: string): { prompt: string } | null;
      isEnabled(n: string): boolean;
    }>(ServiceNames.SKILL_REGISTRY);
    if (!registry) return null;
    const skill = registry.get(name);
    if (!skill || !registry.isEnabled(name)) return null;
    return skill.prompt;
  }

  /** 摘要模型解析（设置页/调试） */
  resolveSummaryModelId(): string {
    const config = this.getConfig();
    const main = this.resolveMainModel();
    return resolveSummaryModel(config.compaction.summaryModel, main, []).requestModel;
  }
}
