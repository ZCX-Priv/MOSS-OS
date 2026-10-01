// src/modules/server/routes/agenteams.ts
// agenteam 编排 REST 路由（团队会话由 agent 工具创建，此处供 UI 面板与外部调用）
// GET    /api/agenteams                        列出全部团队（摘要）
// GET    /api/agenteams/:id                    团队详情（成员/任务）
// GET    /api/agenteams/:id/messages           消息流（?since=ts）
// POST   /api/agenteams                        创建团队（UI；approval=true 走审批）
// POST   /api/agenteams/:id/approve            审批通过
// POST   /api/agenteams/:id/discard            驳回计划
// POST   /api/agenteams/:id/halt               暂停
// POST   /api/agenteams/:id/resume             恢复
// DELETE /api/agenteams/:id                    删除
// GET    /api/agenteam-profiles                团队模板列表
// POST   /api/agenteam-profiles                保存团队模板
// DELETE /api/agenteam-profiles/:name          删除团队模板
// POST   /api/subagents/run                    手动运行临时 subagent

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry } from '../../../core/types';
import { ErrorCode } from '../../../core/error-codes';
import type { AgentEngine } from '../../contracts';
import type { TeamOrchestrator } from '../../agenteam/orchestrator';
import type { TaskKind, TeamProfileConfig } from '../../agenteam/types';
import type { PermissionMode } from '../../safety/types';

function resolveOrchestrator(services: ServiceRegistry): TeamOrchestrator | null {
  return services.tryResolve<TeamOrchestrator>('agenteam.orchestrator');
}

/** 从请求体提取权限模式（容错） */
function toPermissionMode(v: unknown): PermissionMode | undefined {
  return v === 'ask' || v === 'auto' || v === 'skip' ? v : undefined;
}

// ============================================================================
// 团队
// ============================================================================

export function createListAgenteamsHandler(services: ServiceRegistry): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    return { status: 200, body: { teams: orch.summaries() } };
  };
}

export function createGetAgenteamHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AGENTEAM_ID_REQUIRED } };
    }
    const team = orch.get(id);
    if (!team) {
      return { status: 404, body: { error: ErrorCode.AGENTEAM_NOT_FOUND } };
    }
    return { status: 200, body: team };
  };
}

export function createGetAgenteamMessagesHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AGENTEAM_ID_REQUIRED } };
    }
    if (!orch.get(id)) {
      return { status: 404, body: { error: ErrorCode.AGENTEAM_NOT_FOUND } };
    }
    const sinceRaw = req.query?.since;
    const since = typeof sinceRaw === 'string' ? Number(sinceRaw) : undefined;
    const messages = orch.getMessages(id, Number.isFinite(since) ? since : undefined);
    return { status: 200, body: { messages } };
  };
}

export function createCreateAgenteamHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const body = (req.body ?? {}) as {
      name?: string;
      description?: string;
      cwd?: string;
      permissionMode?: string;
      captainSessionId?: string;
      members?: Array<{ name?: string; role?: string; agentId?: string; inlinePrompt?: string }>;
      tasks?: Array<{ subject?: string; description?: string; kind?: string; dependencies?: string[]; assignee?: string; reviewedTaskId?: string; sourceTaskId?: string }>;
      approval?: boolean;
    };
    if (!body.name?.trim()) {
      return { status: 400, body: { error: ErrorCode.AGENTEAM_NAME_REQUIRED } };
    }
    if (!body.members || body.members.length === 0) {
      return { status: 400, body: { error: ErrorCode.AGENTEAM_MEMBERS_REQUIRED } };
    }
    if (!body.cwd?.trim()) {
      return { status: 400, body: { error: ErrorCode.INVALID_BODY } };
    }
    // 队长恒为某个真实存在的会话（主 agent 即队长）：UI 建队必须显式绑定
    const captainSessionId = body.captainSessionId?.trim() ?? '';
    if (!captainSessionId) {
      return { status: 400, body: { error: ErrorCode.AGENTEAM_INVALID_STATE, message: 'captainSessionId is required' } };
    }
    const agent = services.tryResolve<AgentEngine & { getSessionForContext?: (id: string) => unknown }>('agent.engine');
    if (agent?.getSessionForContext && !agent.getSessionForContext(captainSessionId)) {
      return { status: 400, body: { error: ErrorCode.AGENTEAM_INVALID_STATE, message: `captain session "${captainSessionId}" not found` } };
    }
    try {
      const team = orch.createTeam({
        name: body.name,
        description: body.description,
        cwd: body.cwd,
        permissionMode: toPermissionMode(body.permissionMode),
        captainSessionId,
        members: body.members.map((m) => ({
          name: m.name ?? '',
          role: m.role,
          agentId: m.agentId,
          inlinePrompt: m.inlinePrompt,
        })),
        tasks: (body.tasks ?? []).map((t) => ({
          subject: t.subject ?? '',
          description: t.description,
          kind: t.kind as TaskKind | undefined,
          dependencies: t.dependencies ?? [],
          assignee: t.assignee,
          reviewedTaskId: t.reviewedTaskId,
          sourceTaskId: t.sourceTaskId,
        })),
        approval: body.approval !== false,
      });
      return { status: 201, body: team };
    } catch (err) {
      return { status: 400, body: { error: ErrorCode.AGENTEAM_INVALID_STATE, message: err instanceof Error ? err.message : String(err) } };
    }
  };
}

export function createApproveAgenteamHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AGENTEAM_ID_REQUIRED } };
    }
    try {
      const team = orch.approvePlan(id);
      return { status: 200, body: team };
    } catch (err) {
      return { status: 400, body: { error: ErrorCode.AGENTEAM_INVALID_STATE, message: err instanceof Error ? err.message : String(err) } };
    }
  };
}

export function createDiscardAgenteamHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AGENTEAM_ID_REQUIRED } };
    }
    try {
      const team = orch.discardPlan(id);
      return { status: 200, body: team };
    } catch (err) {
      return { status: 400, body: { error: ErrorCode.AGENTEAM_INVALID_STATE, message: err instanceof Error ? err.message : String(err) } };
    }
  };
}

export function createHaltAgenteamHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AGENTEAM_ID_REQUIRED } };
    }
    if (!orch.get(id)) {
      return { status: 404, body: { error: ErrorCode.AGENTEAM_NOT_FOUND } };
    }
    const team = orch.halt(id);
    return { status: 200, body: team };
  };
}

export function createResumeAgenteamHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AGENTEAM_ID_REQUIRED } };
    }
    if (!orch.get(id)) {
      return { status: 404, body: { error: ErrorCode.AGENTEAM_NOT_FOUND } };
    }
    const team = orch.resume(id);
    return { status: 200, body: team };
  };
}

export function createDeleteAgenteamHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AGENTEAM_ID_REQUIRED } };
    }
    const deleted = orch.deleteTeam(id);
    if (!deleted) {
      return { status: 404, body: { error: ErrorCode.AGENTEAM_NOT_FOUND } };
    }
    return { status: 200, body: { deleted: true } };
  };
}

// ============================================================================
// 团队模板
// ============================================================================

export function createListAgenteamProfilesHandler(services: ServiceRegistry): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    return { status: 200, body: { profiles: orch.listProfiles() } };
  };
}

export function createSaveAgenteamProfileHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const body = (req.body ?? {}) as Partial<TeamProfileConfig>;
    if (!body.name?.trim() || !Array.isArray(body.members) || body.members.length === 0 || !Array.isArray(body.tasks)) {
      return { status: 400, body: { error: ErrorCode.AGENTEAM_PROFILE_INVALID } };
    }
    const ok = orch.saveProfile({
      name: body.name,
      description: body.description,
      protocol: body.protocol,
      executionPrompt: body.executionPrompt,
      members: body.members,
      tasks: body.tasks,
      taskPlanning: body.taskPlanning === 'captain' ? 'captain' : 'seed',
      reviewPolicy: body.reviewPolicy,
    });
    if (!ok) {
      return { status: 400, body: { error: ErrorCode.AGENTEAM_PROFILE_INVALID, message: 'builtin profile name cannot be overwritten' } };
    }
    return { status: 201, body: { saved: true } };
  };
}

export function createDeleteAgenteamProfileHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const name = params?.name;
    if (!name) {
      return { status: 400, body: { error: ErrorCode.INVALID_BODY } };
    }
    const deleted = orch.deleteProfile(name);
    if (!deleted) {
      return { status: 404, body: { error: ErrorCode.AGENTEAM_NOT_FOUND } };
    }
    return { status: 200, body: { deleted: true } };
  };
}

// ============================================================================
// 临时 Subagent
// ============================================================================

export function createRunSubagentHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const body = (req.body ?? {}) as {
      template?: string;
      task?: string;
      cwd?: string;
      permissionMode?: string;
    };
    if (!body.template?.trim() || !body.task?.trim() || !body.cwd?.trim()) {
      return { status: 400, body: { error: ErrorCode.SUBAGENT_TEMPLATE_REQUIRED } };
    }
    try {
      const output = await orch.runSubagent({
        template: body.template,
        task: body.task,
        cwd: body.cwd,
        permissionMode: toPermissionMode(body.permissionMode),
      });
      return { status: 200, body: output };
    } catch (err) {
      return { status: 400, body: { error: ErrorCode.SUBAGENT_TEMPLATE_REQUIRED, message: err instanceof Error ? err.message : String(err) } };
    }
  };
}