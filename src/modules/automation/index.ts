// src/modules/automation/index.ts
// Automation 模组入口：实现 AutomationService，注册 automation.service 服务。
// 持久化：~/.moss/automations.json + ~/.moss/automations-history.json
// 调度：cron-parser 解析 + setTimeout 调度循环
// 触发：调用 agent.engine.run({临时 sessionId, userMessage: prompt})，通过 server.instance.broadcastWS 推送事件

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import cronParser from 'cron-parser';
import type { Module, ModuleContext, ModuleManifest, Environment, Logger, ServiceRegistry, EventBus } from '../../core/types';
import { ServiceNames } from '../../core/types';
import type { AgentEngine, AgentEvent } from '../contracts';
import type { ServerInstanceLike } from '../contracts';

// ============================================================================
// 类型定义（与前端 webui/src/types/api.ts 对齐）
// ============================================================================

export interface AutomationItem {
  id: string;
  title: string;
  description?: string;
  cron: string;
  prompt: string;
  agentId?: string;
  enabled: boolean;
  paused: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'success' | 'failed' | 'timeout';
  finishReason?: string;
  finalText?: string;
  error?: string;
}

interface AutomationsStoreData {
  version: number;
  automations: AutomationItem[];
}

interface HistoryStoreData {
  version: number;
  /** 按 automationId 索引的运行记录（最近 50 条） */
  history: Record<string, AutomationRun[]>;
}

export interface AutomationTemplate {
  id: string;
  title: string;
  description: string;
  iconGradient?: string;
  cron?: string;
  promptTemplate?: string;
}

// ============================================================================
// 内置模板（与 UI AutomationPage 现有 templates 对齐）
// ============================================================================

const BUILTIN_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'news-daily',
    title: '每日 AI 新闻简报',
    description: '每天早上推送 AI 行业热点新闻摘要与趋势分析',
    iconGradient: 'linear-gradient(135deg, #6B4BCC, #8b5cf6)',
    cron: '0 9 * * *',
    promptTemplate: '请搜索并汇总今天的 AI 行业热点新闻，生成一份简报',
  },
  {
    id: 'brand-weekly',
    title: '品牌舆情监控周报',
    description: '每周自动抓取品牌在社交媒体和社区中的提及与评价，生成舆情摘要',
    iconGradient: 'linear-gradient(135deg, #4B8BFF, #2563eb)',
    cron: '0 10 * * 1',
    promptTemplate: '请汇总本周品牌舆情，生成周报',
  },
  {
    id: 'competitor-weekly',
    title: '每周竞品动态追踪',
    description: '定期追踪竞品的产品更新、社区反馈和重要新闻',
    iconGradient: 'linear-gradient(135deg, #10b981, #059669)',
    cron: '0 10 * * 1',
    promptTemplate: '请追踪并汇总本周竞品动态',
  },
  {
    id: 'stock-monitor',
    title: '股价监控与预警',
    description: '每天追踪关注的股票价格变动，异常波动时自动预警',
    iconGradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
    cron: '0 16 * * 1-5',
    promptTemplate: '请查询关注股票今日价格变动，如有异常波动请预警',
  },
  {
    id: 'security-scan',
    title: '安全漏洞扫描',
    description: '定期扫描代码仓库，发现经过验证的中高危安全漏洞',
    iconGradient: 'linear-gradient(135deg, #ef4444, #dc2626)',
    cron: '0 2 * * 0',
    promptTemplate: '请扫描代码仓库，报告中高危安全漏洞',
  },
  {
    id: 'bug-scan',
    title: '扫描提交发现 Bug',
    description: '分析最近的代码提交，发现可能导致严重后果的高危 Bug',
    iconGradient: 'linear-gradient(135deg, #ec4899, #be185d)',
    cron: '0 2 * * *',
    promptTemplate: '请分析最近的代码提交，发现高危 Bug',
  },
  {
    id: 'test-coverage',
    title: '补充测试覆盖',
    description: '识别最近变更中缺少测试的高风险代码，自动补充测试',
    iconGradient: 'linear-gradient(135deg, #06b6d4, #0891b2)',
    cron: '0 3 * * 0',
    promptTemplate: '请识别最近变更中缺少测试的高风险代码，补充测试',
  },
  {
    id: 'daily-summary',
    title: '每日变更摘要',
    description: '每天汇总代码仓库的变更情况，生成团队可读的工程日报',
    iconGradient: 'linear-gradient(135deg, #6366f1, #4f46d5)',
    cron: '0 18 * * 1-5',
    promptTemplate: '请汇总今天的代码变更，生成工程日报',
  },
];

// ============================================================================
// AutomationService 实现
// ============================================================================

export interface AutomationService {
  list(): AutomationItem[];
  get(id: string): AutomationItem | null;
  create(data: {
    title: string;
    cron: string;
    prompt: string;
    description?: string;
    agentId?: string;
  }): AutomationItem;
  update(id: string, patch: Partial<AutomationItem>): AutomationItem | null;
  remove(id: string): boolean;
  trigger(id: string): { runId: string };
  pause(id: string): boolean;
  resume(id: string): boolean;
  getHistory(id: string): AutomationRun[];
  listTemplates(): AutomationTemplate[];
}

class AutomationServiceImpl implements AutomationService {
  private readonly storePath: string;
  private readonly historyPath: string;
  private readonly logger: Logger;
  private readonly services: ServiceRegistry;
  private readonly eventBus: EventBus;
  private readonly env: Environment;
  private data: AutomationsStoreData;
  private history: HistoryStoreData;
  /** 调度定时器索引：automationId -> timer */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** 正在运行的 automation：runId -> { automationId, startedAt, controller } */
  private readonly running = new Map<string, {
    automationId: string;
    startedAt: string;
    controller: AbortController;
  }>();

  constructor(deps: {
    env: Environment;
    logger: Logger;
    services: ServiceRegistry;
    eventBus: EventBus;
  }) {
    this.env = deps.env;
    this.logger = deps.logger;
    this.services = deps.services;
    this.eventBus = deps.eventBus;
    this.storePath = join(deps.env.dataDir, 'automations.json');
    this.historyPath = join(deps.env.dataDir, 'automations-history.json');
    this.data = this.load();
    this.history = this.loadHistory();
  }

  /** 启动调度器（在模组 initialize 后调用） */
  startScheduler(): void {
    for (const a of this.data.automations) {
      this.scheduleNext(a);
    }
    this.logger.info('Automation scheduler started', {
      scheduled: this.data.automations.filter(a => a.enabled && !a.paused).length,
    });
  }

  /** 停止所有调度 */
  stopScheduler(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    // 中断正在运行的 automation
    for (const r of this.running.values()) {
      r.controller.abort();
    }
    this.logger.info('Automation scheduler stopped');
  }

  // ========================================================================
  // 持久化
  // ========================================================================

  private load(): AutomationsStoreData {
    try {
      const raw = readFileSync(this.storePath, 'utf8');
      const parsed = JSON.parse(raw) as AutomationsStoreData;
      if (!parsed.automations || !Array.isArray(parsed.automations)) {
        return { version: 1, automations: [] };
      }
      return parsed;
    } catch {
      return { version: 1, automations: [] };
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.storePath), { recursive: true });
      writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      this.logger.error('Failed to save automations.json', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private loadHistory(): HistoryStoreData {
    try {
      const raw = readFileSync(this.historyPath, 'utf8');
      const parsed = JSON.parse(raw) as HistoryStoreData;
      if (!parsed.history || typeof parsed.history !== 'object') {
        return { version: 1, history: {} };
      }
      return parsed;
    } catch {
      return { version: 1, history: {} };
    }
  }

  private saveHistory(): void {
    try {
      mkdirSync(dirname(this.historyPath), { recursive: true });
      writeFileSync(this.historyPath, JSON.stringify(this.history, null, 2), 'utf8');
    } catch (err) {
      this.logger.error('Failed to save automations-history.json', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ========================================================================
  // CRUD
  // ========================================================================

  list(): AutomationItem[] {
    return this.data.automations.map(a => ({ ...a }));
  }

  get(id: string): AutomationItem | null {
    const a = this.data.automations.find(x => x.id === id);
    return a ? { ...a } : null;
  }

  create(data: {
    title: string;
    cron: string;
    prompt: string;
    description?: string;
    agentId?: string;
  }): AutomationItem {
    // 校验 cron
    this.validateCron(data.cron);

    const now = new Date().toISOString();
    const item: AutomationItem = {
      id: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: data.title,
      description: data.description,
      cron: data.cron,
      prompt: data.prompt,
      agentId: data.agentId,
      enabled: true,
      paused: false,
      createdAt: now,
    };
    this.data.automations.push(item);
    this.save();
    this.scheduleNext(item);
    this.logger.info(`Automation created: ${item.id} (${item.title})`);
    return { ...item };
  }

  update(id: string, patch: Partial<AutomationItem>): AutomationItem | null {
    const idx = this.data.automations.findIndex(a => a.id === id);
    if (idx < 0) return null;
    // 校验 cron（如提供）
    if (patch.cron !== undefined) {
      this.validateCron(patch.cron);
    }
    // 不允许通过 patch 修改 id / createdAt
    const { id: _omitId, createdAt: _omitCreatedAt, ...allowedPatch } = patch;
    const updated = { ...this.data.automations[idx], ...allowedPatch };
    this.data.automations[idx] = updated;
    this.save();
    // 重新调度
    this.cancelSchedule(id);
    if (updated.enabled && !updated.paused) {
      this.scheduleNext(updated);
    }
    this.logger.info(`Automation updated: ${id}`);
    return { ...updated };
  }

  remove(id: string): boolean {
    const idx = this.data.automations.findIndex(a => a.id === id);
    if (idx < 0) return false;
    this.cancelSchedule(id);
    this.data.automations.splice(idx, 1);
    this.save();
    // 历史保留（可后续清理）
    this.logger.info(`Automation removed: ${id}`);
    return true;
  }

  // ========================================================================
  // 触发 / 暂停 / 恢复
  // ========================================================================

  trigger(id: string): { runId: string } {
    const item = this.data.automations.find(a => a.id === id);
    if (!item) {
      throw new Error(`automation '${id}' not found`);
    }
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // 异步执行，不阻塞
    void this.executeRun(item, runId);
    return { runId };
  }

  pause(id: string): boolean {
    const idx = this.data.automations.findIndex(a => a.id === id);
    if (idx < 0) return false;
    if (this.data.automations[idx].paused) return true;
    this.data.automations[idx].paused = true;
    this.save();
    this.cancelSchedule(id);
    this.logger.info(`Automation paused: ${id}`);
    return true;
  }

  resume(id: string): boolean {
    const idx = this.data.automations.findIndex(a => a.id === id);
    if (idx < 0) return false;
    if (!this.data.automations[idx].paused) return true;
    this.data.automations[idx].paused = false;
    this.save();
    if (this.data.automations[idx].enabled) {
      this.scheduleNext(this.data.automations[idx]);
    }
    this.logger.info(`Automation resumed: ${id}`);
    return true;
  }

  getHistory(id: string): AutomationRun[] {
    return (this.history.history[id] ?? []).map(r => ({ ...r }));
  }

  listTemplates(): AutomationTemplate[] {
    return BUILTIN_TEMPLATES.map(t => ({ ...t }));
  }

  // ========================================================================
  // 调度
  // ========================================================================

  private validateCron(cron: string): void {
    try {
      cronParser.parse(cron);
    } catch {
      throw new Error(`invalid cron expression: ${cron}`);
    }
  }

  private cancelSchedule(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  private scheduleNext(item: AutomationItem): void {
    if (!item.enabled || item.paused) return;
    this.cancelSchedule(item.id);

    let next: Date;
    try {
      const interval = cronParser.parse(item.cron);
      next = interval.next().toDate();
    } catch (err) {
      this.logger.warn(`Failed to parse cron for automation ${item.id}`, {
        cron: item.cron,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const delay = next.getTime() - Date.now();
    // 更新 nextRunAt
    const idx = this.data.automations.findIndex(a => a.id === item.id);
    if (idx >= 0) {
      this.data.automations[idx].nextRunAt = next.toISOString();
      this.save();
    }

    // setTimeout 上限约为 24.8 天，超大 delay 需分段
    const MAX_TIMEOUT = 2_000_000_000;
    const scheduleFn = () => {
      const timer = setTimeout(() => {
        this.timers.delete(item.id);
        void this.executeRun(item, `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)
          .catch(err => {
            this.logger.error(`Automation run failed: ${item.id}`, {
              error: err instanceof Error ? err.message : String(err),
            });
          })
          .finally(() => {
            // 调度下一次
            const current = this.data.automations.find(a => a.id === item.id);
            if (current && current.enabled && !current.paused) {
              this.scheduleNext(current);
            }
          });
      }, Math.min(delay, MAX_TIMEOUT));
      this.timers.set(item.id, timer);
    };

    if (delay > MAX_TIMEOUT) {
      // 分段等待：先等待 MAX_TIMEOUT，再重新计算
      const timer = setTimeout(() => {
        this.timers.delete(item.id);
        const current = this.data.automations.find(a => a.id === item.id);
        if (current && current.enabled && !current.paused) {
          this.scheduleNext(current);
        }
      }, MAX_TIMEOUT);
      this.timers.set(item.id, timer);
    } else {
      scheduleFn();
    }
  }

  // ========================================================================
  // 执行
  // ========================================================================

  private async executeRun(item: AutomationItem, runId: string): Promise<void> {
    const agent = this.services.tryResolve<AgentEngine>(ServiceNames.AGENT_ENGINE);
    const server = this.services.tryResolve<ServerInstanceLike>(ServiceNames.SERVER_INSTANCE);

    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    this.running.set(runId, { automationId: item.id, startedAt, controller });

    // 更新 lastRunAt
    const idx = this.data.automations.findIndex(a => a.id === item.id);
    if (idx >= 0) {
      this.data.automations[idx].lastRunAt = startedAt;
      this.save();
    }

    // 记录运行开始
    const run: AutomationRun = {
      id: runId,
      automationId: item.id,
      startedAt,
      status: 'running',
    };
    this.addHistory(item.id, run);

    // 推送 automation.started
    server?.broadcastWS({
      type: 'automation.started',
      payload: { automationId: item.id, runId, startedAt },
    });
    this.eventBus.broadcast('automation:started', { automationId: item.id, runId }).catch(() => {});

    this.logger.info(`Automation run started: ${item.id} (run ${runId})`);

    // 临时 sessionId
    const sessionId = `auto_sess_${runId}`;

    // 事件转发到 WS（可选：只转发到 server.broadcastWS）
    const onEvent = (event: AgentEvent): void => {
      // 仅转发错误与完成事件，避免刷屏
      if (event.type === 'error' || event.type === 'done') {
        server?.broadcastWS({
          type: 'automation.event',
          payload: { automationId: item.id, runId, event },
        });
      }
    };

    try {
      if (!agent) {
        throw new Error('agent.engine not available');
      }
      const result = await agent.run({
        sessionId,
        userMessage: item.prompt,
        cwd: this.env.homeDir,
        onEvent,
        signal: controller.signal,
      });

      const finishedAt = new Date().toISOString();
      const status: AutomationRun['status'] =
        result.finishReason === 'error' ? 'failed' :
        result.finishReason === 'aborted' ? 'failed' :
        result.finishReason === 'length' ? 'timeout' : 'success';

      this.updateHistoryRun(item.id, runId, {
        finishedAt,
        status,
        finishReason: result.finishReason,
        finalText: result.finalText,
      });

      server?.broadcastWS({
        type: 'automation.finished',
        payload: {
          automationId: item.id,
          runId,
          startedAt,
          finishedAt,
          status,
          finishReason: result.finishReason,
          finalText: result.finalText,
        },
      });
      this.eventBus.broadcast('automation:finished', {
        automationId: item.id,
        runId,
        status,
      }).catch(() => {});

      this.logger.info(`Automation run finished: ${item.id} (run ${runId})`, {
        status,
        finishReason: result.finishReason,
      });
    } catch (err) {
      const finishedAt = new Date().toISOString();
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.updateHistoryRun(item.id, runId, {
        finishedAt,
        status: 'failed',
        error: errorMsg,
      });
      server?.broadcastWS({
        type: 'automation.finished',
        payload: {
          automationId: item.id,
          runId,
          startedAt,
          finishedAt,
          status: 'failed',
          error: errorMsg,
        },
      });
      this.logger.error(`Automation run failed: ${item.id} (run ${runId})`, { error: errorMsg });
    } finally {
      this.running.delete(runId);
    }
  }

  private addHistory(automationId: string, run: AutomationRun): void {
    if (!this.history.history[automationId]) {
      this.history.history[automationId] = [];
    }
    this.history.history[automationId].unshift(run);
    // 限制 50 条
    if (this.history.history[automationId].length > 50) {
      this.history.history[automationId] = this.history.history[automationId].slice(0, 50);
    }
    this.saveHistory();
  }

  private updateHistoryRun(automationId: string, runId: string, patch: Partial<AutomationRun>): void {
    const list = this.history.history[automationId];
    if (!list) return;
    const idx = list.findIndex(r => r.id === runId);
    if (idx < 0) return;
    list[idx] = { ...list[idx], ...patch };
    this.saveHistory();
  }
}

// ============================================================================
// Module 入口
// ============================================================================

class AutomationModule implements Module {
  manifest!: ModuleManifest;
  private service: AutomationServiceImpl | null = null;

  async initialize(ctx: ModuleContext): Promise<void> {
    this.service = new AutomationServiceImpl({
      env: ctx.env,
      logger: ctx.logger,
      services: ctx.services,
      eventBus: ctx.eventBus,
    });
    ctx.services.register(ServiceNames.AUTOMATION_SERVICE, this.service, {
      scope: 'automation',
      registrantType: 'module',
    });
    this.service.startScheduler();
    ctx.logger.info('Automation module initialized', {
      automationCount: this.service.list().length,
      templateCount: this.service.listTemplates().length,
    });
  }

  async destroy(): Promise<void> {
    this.service?.stopScheduler();
  }
}

export default (manifest: ModuleManifest): Module => {
  const m = new AutomationModule();
  m.manifest = manifest;
  return m;
};
