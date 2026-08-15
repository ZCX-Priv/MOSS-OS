// src/modules/server/routes/truncate.ts
// 消息撤回（截断）路由：
// GET  /api/sessions/:id/truncate-preview?messageTimestamp=xxx  —— 预览将删除的消息与将回滚的文件变更
// POST /api/sessions/:id/truncate        —— 执行撤回（body: { messageTimestamp, content }）
// POST /api/sessions/:id/truncate-restore —— 恢复最近一次撤回（redo）

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry } from '../../../core/types';
import type { AgentEngine } from '../../contracts';
import { ErrorCode } from '../../../core/error-codes';

type AgentEngineWithTruncate = AgentEngine & {
  previewTruncate?: (sessionId: string, messageTimestamp: string, content: string) => unknown;
  truncateFrom?: (sessionId: string, messageTimestamp: string, content: string) => Promise<unknown>;
  restoreTruncate?: (sessionId: string) => Promise<unknown>;
};

function resolveEngine(services: ServiceRegistry): AgentEngineWithTruncate | null {
  return services.tryResolve<AgentEngineWithTruncate>('agent.engine');
}

/** GET /api/sessions/:id/truncate-preview?messageTimestamp=xxx&content=yyy */
export function createTruncatePreviewHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const sessionId = params?.id;
    if (!sessionId) {
      return { status: 400, body: { error: ErrorCode.SESSION_ID_REQUIRED } };
    }
    const engine = resolveEngine(services);
    if (!engine?.previewTruncate) {
      return { status: 503, body: { error: ErrorCode.AGENT_ENGINE_UNAVAILABLE } };
    }
    const url = _req.url ?? '';
    const query = new URL(url, 'http://localhost').searchParams;
    const messageTimestamp = query.get('messageTimestamp') ?? '';
    const content = query.get('content') ?? '';
    if (!messageTimestamp && !content) {
      return { status: 400, body: { error: 'messageTimestamp or content is required' } };
    }
    const preview = engine.previewTruncate(sessionId, messageTimestamp, content);
    if (!preview) {
      return { status: 404, body: { error: 'target message not found' } };
    }
    return { status: 200, body: { sessionId, ...preview as object } };
  };
}

/** POST /api/sessions/:id/truncate body: { messageTimestamp, content } */
export function createTruncateHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const sessionId = params?.id;
    if (!sessionId) {
      return { status: 400, body: { error: ErrorCode.SESSION_ID_REQUIRED } };
    }
    const engine = resolveEngine(services);
    if (!engine?.truncateFrom) {
      return { status: 503, body: { error: ErrorCode.AGENT_ENGINE_UNAVAILABLE } };
    }
    const body = (req.body ?? {}) as { messageTimestamp?: string; content?: string };
    if (!body.messageTimestamp || typeof body.content !== 'string') {
      return { status: 400, body: { error: 'messageTimestamp and content are required' } };
    }
    const result = await engine.truncateFrom(sessionId, body.messageTimestamp, body.content);
    if (!result) {
      return { status: 404, body: { error: 'target message not found' } };
    }
    return { status: 200, body: { sessionId, ...result as object } };
  };
}

/** POST /api/sessions/:id/truncate-restore */
export function createTruncateRestoreHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const sessionId = params?.id;
    if (!sessionId) {
      return { status: 400, body: { error: ErrorCode.SESSION_ID_REQUIRED } };
    }
    const engine = resolveEngine(services);
    if (!engine?.restoreTruncate) {
      return { status: 503, body: { error: ErrorCode.AGENT_ENGINE_UNAVAILABLE } };
    }
    const result = await engine.restoreTruncate(sessionId);
    if (!result) {
      return { status: 404, body: { error: 'no truncation to restore' } };
    }
    return { status: 200, body: { sessionId, ...result as object } };
  };
}
