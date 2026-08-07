// src/modules/server/routes/search.ts
// GET /api/search?q=xxx —— 搜索任务标题 + 会话消息内容

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry } from '../../../core/types';
import type { AgentEngine } from '../../contracts';

type AgentEngineWithSearch = AgentEngine & {
  searchAll?: (query: string) => {
    tasks: Array<{
      id: string;
      title: string;
      groupId: string;
      createdAt: string;
      updatedAt: string;
      active?: boolean;
      sessionId?: string;
    }>;
    messages: Array<{ sessionId: string; messageId: string; text: string }>;
  };
};

export function createSearchHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const q = req.query.q;
    if (!q || q.trim() === '') {
      return { status: 200, body: { tasks: [], messages: [] } };
    }
    const engine = services.tryResolve<AgentEngineWithSearch>('agent.engine');
    if (!engine?.searchAll) {
      return { status: 200, body: { tasks: [], messages: [] } };
    }
    const result = engine.searchAll(q);
    return { status: 200, body: result };
  };
}
