// src/modules/server/routes/agent-teams.ts
// AgentTeam 编排 REST 路由
// GET    /api/agent-teams                       列出全部团队（摘要）
// GET    /api/agent-teams/:id                   团队详情（成员/任务）
// GET    /api/agent-teams/:id/messages          消息流（?since=ts）
// POST   /api/agent-teams                       创建团队（UI；approval=true 走审批）
// POST   /api/agent-teams/:id/approve           审批通过
// POST   /api/agent-teams/:id/discard           驳回计划
// POST   /api/agent-teams/:id/halt              暂停
// POST   /api/agent-teams/:id/resume            恢复
// DELETE /api/agent-teams/:id                   删除
// GET    /api/agent-team-profiles               团队模板列表
// POST   /api/agent-team-profiles               保存团队模板
// DELETE /api/agent-team-profiles/:name         删除团队模板
// POST   /api/subagents/run                    手动运行临时 subagent

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry } from '../../../core/types';
import { ErrorCode } from '../../../core/error-codes';
import type { TeamOrchestrator } from '../../agenteam/orchestrator';
import type { TeamProfileConfig } from '../../agenteam/types';
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

export function createListAgentTeamsHandler(services: ServiceRegistry): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    return { status: 200, body: { teams: orch.summaries() } };
  };
}

export function createGetAgentTeamHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AGENTTEAM_ID_REQUIRED } };
    }
    const team = orch.get(id);
    if (!team) {
      return { status: 404, body: { error: ErrorCode.AGENTTEAM_NOT_FOUND } };
    }
    return { status: 200, body: team };
  };
}

export function createGetAgentTeamMessagesHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AGENTTEAM_ID_REQUIRED } };
    }
    if (!orch.get(id)) {
      return { status: 404, body: { error: ErrorCode.AGENTTEAM_NOT_FOUND } };
    }
    const sinceRaw = req.query?.since;
    const since = typeof sinceRaw === 'string' ? Number(sinceRaw) : undefined;
    const messages = orch.getMessages(id, Number.isFinite(since) ? since : undefined);
    return { status: 200, body: { messages } };
  };
}

export function createCreateAgentTeamHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const body = (req.body ?? {}) as {
      name?: string;
      description?: string;
      cwd?: string;
      permissionMode?: string;
      members?: Array<{ name?: string; role?: string; agentId?: string; inlinePrompt?: string }>;
      tasks?: Array<{ subject?: string; description?: string; kind?: string; dependencies?: string[]; assignee?: string }>;
      approval?: boolean;
    };
    if (!body.name?.trim()) {
      return { status: 400, body: { error: ErrorCode.AGENTTEAM_NAME_REQUIRED } };
    }
    if (!body.members || body.members.length === 0) {
      return { status: 400, body: { error: ErrorCode.AGENTTEAM_MEMBERS_REQUIRED } };
    }
    if (!body.cwd?.trim()) {
      return { status: 400, body: { error: ErrorCode.INVALID_BODY } };
    }
    try {
      const team = orch.createTeam({
        name: body.name,
        description: body.description,
        cwd: body.cwd,
        permissionMode: toPermissionMode(body.permissionMode),
        // UI 创建无 captain 会话（空标记；后续主对话仍可接管）
        captainSessionId: '',
        members: body.members.map((m) => ({
          name: m.name ?? '',
          role: m.role,
          agentId: m.agentId,
          inlinePrompt: m.inlinePrompt,
        })),
        tasks: (body.tasks ?? []).map((t) => ({
          subject: t.subject ?? '',
          description: t.description,
          dependencies: t.dependencies ?? [],
          assignee: t.assignee,
        })),
        approval: body.approval !== false,
      });
      return { status: 201, body: team };
    } catch (err) {
      return { status: 400, body: { error: ErrorCode.AGENTTEAM_INVALID_STATE, message: err instanceof Error ? err.message : String(err) } };
    }
  };
}

export function createApproveAgentTeamHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AGENTTEAM_ID_REQUIRED } };
    }
    try {
      const team = orch.approvePlan(id);
      return { status: 200, body: team };
    } catch (err) {
      return { status: 400, body: { error: ErrorCode.AGENTTEAM_INVALID_STATE, message: err instanceof Error ? err.message : String(err) } };
    }
  };
}

export function createDiscardAgentTeamHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AGENTTEAM_ID_REQUIRED } };
    }
    try {
      const team = orch.discardPlan(id);
      return { status: 200, body: team };
    } catch (err) {
      return { status: 400, body: { error: ErrorCode.AGENTTEAM_INVALID_STATE, message: err instanceof Error ? err.message : String(err) } };
    }
  };
}

export function createHaltAgentTeamHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AGENTTEAM_ID_REQUIRED } };
    }
    if (!orch.get(id)) {
      return { status: 404, body: { error: ErrorCode.AGENTTEAM_NOT_FOUND } };
    }
    const team = orch.halt(id);
    return { status: 200, body: team };
  };
}

export function createResumeAgentTeamHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AGENTTEAM_ID_REQUIRED } };
    }
    if (!orch.get(id)) {
      return { status: 404, body: { error: ErrorCode.AGENTTEAM_NOT_FOUND } };
    }
    const team = orch.resume(id);
    return { status: 200, body: team };
  };
}

export function createDeleteAgentTeamHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.AGENTTEAM_ID_REQUIRED } };
    }
    const deleted = orch.deleteTeam(id);
    if (!deleted) {
      return { status: 404, body: { error: ErrorCode.AGENTTEAM_NOT_FOUND } };
    }
    return { status: 200, body: { deleted: true } };
  };
}

// ============================================================================
// 团队模板
// ============================================================================

export function createListTeamProfilesHandler(services: ServiceRegistry): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    return { status: 200, body: { profiles: orch.listProfiles() } };
  };
}

export function createSaveTeamProfileHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const body = (req.body ?? {}) as Partial<TeamProfileConfig>;
    if (!body.name?.trim() || !Array.isArray(body.members) || body.members.length === 0 || !Array.isArray(body.tasks)) {
      return { status: 400, body: { error: ErrorCode.AGENTTEAM_PROFILE_INVALID } };
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
      return { status: 400, body: { error: ErrorCode.AGENTTEAM_PROFILE_INVALID, message: 'builtin profile name cannot be overwritten' } };
    }
    return { status: 201, body: { saved: true } };
  };
}

export function createDeleteTeamProfileHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const orch = resolveOrchestrator(services);
    if (!orch) {
      return { status: 503, body: { error: ErrorCode.AGENTTEAM_ORCHESTRATOR_UNAVAILABLE } };
    }
    const name = params?.name;
    if (!name) {
      return { status: 400, body: { error: ErrorCode.INVALID_BODY } };
    }
    const deleted = orch.deleteProfile(name);
    if (!deleted) {
      return { status: 404, body: { error: ErrorCode.AGENTTEAM_NOT_FOUND } };
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
      return { status: 503, body: { error: ErrorCode.AGENTTEAM_ORCHESTRATOR_UNAVAILABLE } };
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
