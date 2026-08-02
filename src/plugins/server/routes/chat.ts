// src/plugins/server/routes/chat.ts
// POST /api/chat - 对话接口（非流式，返回最终结果）
// 流式对话通过 WebSocket 进行（ws-handler 处理）

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry } from '../../../core/types';
import type { AgentEngine, AgentEvent } from '../../contracts';

export function createChatHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const agent = services.tryResolve<AgentEngine>('agent.engine');
    if (!agent) {
      return {
        status: 503,
        body: { error: 'Agent engine not available' },
      };
    }

    const body = req.body as ChatRequestBody | undefined;
    if (!body?.message || typeof body.message !== 'string') {
      return { status: 400, body: { error: 'Invalid body, expected { message: string }' } };
    }

    const sessionId = body.sessionId || generateSessionId();
    const events: AgentEvent[] = [];

    try {
      const result = await agent.run({
        sessionId,
        userMessage: body.message,
        model: body.model,
        provider: body.provider,
        cwd: body.cwd || process.cwd(),
        onEvent: (e) => events.push(e),
      });

      return {
        status: 200,
        body: {
          sessionId: result.sessionId,
          finishReason: result.finishReason,
          finalText: result.finalText,
          events,
        },
      };
    } catch (err) {
      return {
        status: 500,
        body: {
          error: err instanceof Error ? err.message : String(err),
          sessionId,
        },
      };
    }
  };
}

export interface ChatRequestBody {
  message: string;
  sessionId?: string;
  model?: string;
  provider?: string;
  cwd?: string;
}

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
