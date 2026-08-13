// src/modules/server/routes/session-context.ts
// GET /api/sessions/:id/context —— 返回会话上下文文件 + token 估算
//
// 阶段 5.1 实现：
//   - files：从 SessionStore.contextFiles 读取真实文件访问轨迹（read/edit/write/grep/glob 累积）。
//   - totalTokens：会话消息历史 tokens（粗略 1 char ≈ 0.5 token）+ 上下文文件 tokens。
//   - maxTokens：读 appConfig.agent.maxTokens。

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry, ConfigService } from '../../../core/types';
import type { AgentEngine } from '../../contracts';
import type { ContextFile } from '../../agent/session';
import { ErrorCode } from '../../../core/error-codes';

export interface SessionContextResponse {
  sessionId: string;
  files: ContextFile[];
  totalTokens: number;
  maxTokens: number;
}

/** 扩展 AgentEngine：暴露上下文文件相关方法（AgentEngineImpl 已实现） */
type AgentEngineWithContext = AgentEngine & {
  getHistory?: (id: string) => unknown;
  getContextFiles?: (id: string) => ContextFile[];
  estimateContextTokens?: (id: string) => number;
};

export function createSessionContextHandler(
  services: ServiceRegistry,
  config: ConfigService,
): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const sessionId = params?.id;
    if (!sessionId) {
      return { status: 400, body: { error: ErrorCode.SESSION_ID_REQUIRED } };
    }

    const maxTokens = config.getAppConfig().agent.maxTokens;
    const agent = services.tryResolve<AgentEngineWithContext>('agent.engine');

    // 1. 会话消息历史 tokens 估算（1 char ≈ 0.5 token）
    let historyTokens = 0;
    if (agent?.getHistory) {
      const history = agent.getHistory(sessionId) as Array<{
        content: string;
        toolCalls?: Array<{ arguments: string }>;
      }>;
      const estimateTokens = (text: string): number => Math.ceil(text.length / 2);
      for (const m of history) {
        historyTokens += estimateTokens(m.content ?? '');
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            historyTokens += estimateTokens(tc.arguments ?? '');
          }
        }
      }
    }

    // 2. 上下文文件轨迹（阶段5.1 回填真实数据）
    const files: ContextFile[] = agent?.getContextFiles ? agent.getContextFiles(sessionId) : [];
    const contextFileTokens = agent?.estimateContextTokens
      ? agent.estimateContextTokens(sessionId)
      : 0;

    const response: SessionContextResponse = {
      sessionId,
      files,
      totalTokens: historyTokens + contextFileTokens,
      maxTokens,
    };

    return { status: 200, body: response };
  };
}