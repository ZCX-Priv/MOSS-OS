// src/modules/server/routes/automations.ts
// 自动化任务 CRUD + 触发/暂停/恢复 + 历史
// GET    /api/automations              —— 列出所有
// POST   /api/automations              —— 创建（scheduleType: cron 周期 / once 一次性定时）
// GET    /api/automations/:id          —— 获取详情（含 history）
// PATCH  /api/automations/:id          —— 更新
// DELETE /api/automations/:id          —— 删除
// POST   /api/automations/:id/trigger  —— 立即触发
// POST   /api/automations/:id/pause    —— 暂停
// POST   /api/automations/:id/resume   —— 恢复
// GET    /api/automations/:id/history  —— 历史

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry } from '../../../core/types';
import type { AutomationService } from '../../automation';
import { ErrorCode } from '../../../core/error-codes';

function resolveService(services: ServiceRegistry): AutomationService | null {
  return services.tryResolve<AutomationService>('automation.service');
}

// ============================================================================
// 列表 / 创建
// ============================================================================

export function createListAutomationsHandler(services: ServiceRegistry): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const svc = resolveService(services);
    if (!svc) {
      return { status: 200, body: { automations: [] } };
    }
    return { status: 200, body: { automations: svc.list() } };
  };
}

export function createCreateAutomationHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const svc = resolveService(services);
    if (!svc) {
      return { status: 503, body: { error: ErrorCode.AUTOMATION_SERVICE_UNAVAILABLE } };
    }
    const body = (req.body ?? {}) as {
      title?: string;
      prompt?: string;
      cwd?: string;
      description?: string;
      icon?: string;
      agentId?: string;
      scheduleType?: 'cron' | 'once';
      cron?: string;
      runAt?: string;
    };
    if (!body.title || !body.prompt || !body.cwd) {
      return { status: 400, body: { error: ErrorCode.AUTOMATION_FIELDS_REQUIRED } };
    }
    try {
      const item = svc.create({
        title: body.title,
        prompt: body.prompt,
        cwd: body.cwd,
        description: body.description,
        icon: body.icon,
        agentId: body.agentId,
        scheduleType: body.scheduleType,
        cron: body.cron,
        runAt: body.runAt,
      });
      return { status: 201, body: item };
    } catch (err) {
      return {
        status: 400,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}

// ============================================================================
// 详情 / 更新 / 删除
// ============================================================================

export function createGetAutomationHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AUTOMATION_ID_REQUIRED } };
    }
    const svc = resolveService(services);
    if (!svc) {
      return { status: 503, body: { error: ErrorCode.AUTOMATION_SERVICE_UNAVAILABLE } };
    }
    const item = svc.get(id);
    if (!item) {
      return { status: 404, body: { error: ErrorCode.AUTOMATION_NOT_FOUND } };
    }
    const history = svc.getHistory(id);
    return { status: 200, body: { ...item, history } };
  };
}

export function createUpdateAutomationHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AUTOMATION_ID_REQUIRED } };
    }
    const svc = resolveService(services);
    if (!svc) {
      return { status: 503, body: { error: ErrorCode.AUTOMATION_SERVICE_UNAVAILABLE } };
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const item = svc.update(id, body);
      if (!item) {
        return { status: 404, body: { error: ErrorCode.AUTOMATION_NOT_FOUND } };
      }
      return { status: 200, body: item };
    } catch (err) {
      return {
        status: 400,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}

export function createDeleteAutomationHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AUTOMATION_ID_REQUIRED } };
    }
    const svc = resolveService(services);
    if (!svc) {
      return { status: 503, body: { error: ErrorCode.AUTOMATION_SERVICE_UNAVAILABLE } };
    }
    const deleted = svc.remove(id);
    if (!deleted) {
      return { status: 404, body: { error: ErrorCode.AUTOMATION_NOT_FOUND } };
    }
    return { status: 200, body: { deleted: true } };
  };
}

// ============================================================================
// 触发 / 暂停 / 恢复
// ============================================================================

export function createTriggerAutomationHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AUTOMATION_ID_REQUIRED } };
    }
    const svc = resolveService(services);
    if (!svc) {
      return { status: 503, body: { error: ErrorCode.AUTOMATION_SERVICE_UNAVAILABLE } };
    }
    try {
      const { runId } = svc.trigger(id);
      return { status: 202, body: { runId } };
    } catch (err) {
      return {
        status: 404,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}

export function createPauseAutomationHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AUTOMATION_ID_REQUIRED } };
    }
    const svc = resolveService(services);
    if (!svc) {
      return { status: 503, body: { error: ErrorCode.AUTOMATION_SERVICE_UNAVAILABLE } };
    }
    const ok = svc.pause(id);
    if (!ok) {
      return { status: 404, body: { error: ErrorCode.AUTOMATION_NOT_FOUND } };
    }
    return { status: 200, body: { paused: true } };
  };
}

export function createResumeAutomationHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AUTOMATION_ID_REQUIRED } };
    }
    const svc = resolveService(services);
    if (!svc) {
      return { status: 503, body: { error: ErrorCode.AUTOMATION_SERVICE_UNAVAILABLE } };
    }
    const ok = svc.resume(id);
    if (!ok) {
      return { status: 404, body: { error: ErrorCode.AUTOMATION_NOT_FOUND } };
    }
    return { status: 200, body: { paused: false } };
  };
}

// ============================================================================
// 历史
// ============================================================================

export function createAutomationHistoryHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AUTOMATION_ID_REQUIRED } };
    }
    const svc = resolveService(services);
    if (!svc) {
      return { status: 503, body: { error: ErrorCode.AUTOMATION_SERVICE_UNAVAILABLE } };
    }
    return { status: 200, body: { history: svc.getHistory(id) } };
  };
}