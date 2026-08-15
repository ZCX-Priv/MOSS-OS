// src/plugins/server/routes/session.ts
// 会话管理路由：POST /api/session（创建）、GET /api/session（列出）、DELETE /api/session/:id

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry } from '../../../core/types';
import type { AgentEngine } from '../../contracts';
import { ErrorCode } from '../../../core/error-codes';

export function createListSessionsHandler(services: ServiceRegistry): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const agent = services.tryResolve<AgentEngine & { listSessions?: () => unknown[] }>('agent.engine');
    if (!agent?.listSessions) {
      return { status: 200, body: { sessions: [] } };
    }
    return { status: 200, body: { sessions: agent.listSessions() } };
  };
}

export function createDeleteSessionHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const sessionId = params?.id ?? (req.body as { sessionId?: string } | null)?.sessionId;
    if (!sessionId) {
      return { status: 400, body: { error: ErrorCode.SESSION_ID_REQUIRED } };
    }
    const agent = services.tryResolve<AgentEngine & { deleteSession?: (id: string) => void }>('agent.engine');
    agent?.deleteSession?.(sessionId);
    return { status: 200, body: { deleted: true, sessionId } };
  };
}

export function createSessionHistoryHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const sessionId = params?.id;
    if (!sessionId) {
      return { status: 400, body: { error: ErrorCode.SESSION_ID_REQUIRED } };
    }
    const agent = services.tryResolve<
      AgentEngine & {
        getHistory?: (id: string) => unknown;
        getActiveSkill?: (id: string) => { name: string; mode: 'system' | 'message'; content: string } | undefined;
      }
    >('agent.engine');
    if (!agent?.getHistory) {
      return { status: 200, body: { sessionId, messages: [] } };
    }
    const history = agent.getHistory(sessionId);
    // 当前激活的 skill 模式（前端刷新后恢复 Badge）
    const activeSkill = agent.getActiveSkill?.(sessionId) ?? undefined;
    return {
      status: 200,
      body: { sessionId, messages: history, ...(activeSkill ? { activeSkill } : {}) },
    };
  };
}