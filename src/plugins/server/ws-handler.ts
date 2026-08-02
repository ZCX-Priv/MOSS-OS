// src/plugins/server/ws-handler.ts
// WebSocket 消息分发：处理前端 WS 消息，转发 Agent 事件到客户端。

import type { Logger, ServiceRegistry } from '../../core/types';
import type { WSMessage, WSMessageHandler, WSConnection } from './types';
import type { AgentEngine, AgentEvent } from '../contracts';

interface ConnectionState {
  conn: WSConnection;
  sessionId?: string;
  /** 当前正在运行的 agent.run 的 AbortController（用于中断） */
  abortController?: AbortController;
}

export class WsHandler {
  private readonly states = new Map<string, ConnectionState>();
  private readonly messageHandlers: WSMessageHandler[] = [];
  private readonly logger: Logger;
  private readonly services: ServiceRegistry;

  constructor(services: ServiceRegistry, logger: Logger) {
    this.services = services;
    this.logger = logger;
  }

  onWSMessage(handler: WSMessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /** 注册新连接 */
  registerConnection(conn: WSConnection): void {
    this.states.set(conn.id, { conn });
    this.logger.debug(`WS connected: ${conn.id}`);
  }

  /** 移除连接 */
  unregisterConnection(id: string): void {
    const state = this.states.get(id);
    if (state?.abortController) {
      state.abortController.abort();
    }
    this.states.delete(id);
    this.logger.debug(`WS disconnected: ${id}`);
  }

  /** 处理来自客户端的消息 */
  async handleMessage(connId: string, raw: string): Promise<void> {
    const state = this.states.get(connId);
    if (!state) return;

    let msg: WSMessage;
    try {
      msg = JSON.parse(raw) as WSMessage;
    } catch {
      state.conn.send({ type: 'error', payload: { message: 'Invalid JSON' } });
      return;
    }

    // 1. 通知注册的 handler
    for (const h of this.messageHandlers) {
      try {
        await h(msg);
      } catch (err) {
        this.logger.error('WS message handler failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. 内置消息处理
    switch (msg.type) {
      case 'chat.stream':
        return this.handleChatStream(state, msg);
      case 'chat.abort':
        return this.handleChatAbort(state, msg);
      case 'session.subscribe':
        return this.handleSessionSubscribe(state, msg);
      default:
        return;
    }
  }

  /** 广播消息到所有连接 */
  broadcast(message: unknown): void {
    const text = JSON.stringify(message);
    for (const state of this.states.values()) {
      state.conn.send(text);
    }
  }

  /** 发送消息到指定 session 的连接 */
  sendToSession(sessionId: string, message: unknown): void {
    const text = JSON.stringify(message);
    for (const state of this.states.values()) {
      if (state.sessionId === sessionId) {
        state.conn.send(text);
      }
    }
  }

  // ========================================================================
  // 内置消息处理
  // ========================================================================

  private async handleChatStream(state: ConnectionState, msg: WSMessage): Promise<void> {
    const agent = this.services.tryResolve<AgentEngine>('agent.engine');
    if (!agent) {
      state.conn.send({ type: 'error', sessionId: msg.sessionId, payload: { message: 'Agent engine not available' } });
      return;
    }

    const payload = (msg.payload ?? {}) as {
      message?: string;
      model?: string;
      provider?: string;
      cwd?: string;
    };

    if (!payload.message) {
      state.conn.send({ type: 'error', sessionId: msg.sessionId, payload: { message: 'message required' } });
      return;
    }

    const sessionId = msg.sessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    state.sessionId = sessionId;

    // 中断控制
    const abortController = new AbortController();
    state.abortController = abortController;

    const onEvent = (event: AgentEvent) => {
      state.conn.send({ type: event.type, sessionId: event.sessionId, payload: event });
    };

    try {
      const result = await agent.run({
        sessionId,
        userMessage: payload.message,
        model: payload.model,
        provider: payload.provider,
        cwd: payload.cwd || process.cwd(),
        onEvent,
        signal: abortController.signal,
      });

      state.conn.send({
        type: 'chat.done',
        sessionId: result.sessionId,
        payload: {
          finishReason: result.finishReason,
          finalText: result.finalText,
        },
      });
    } catch (err) {
      state.conn.send({
        type: 'error',
        sessionId,
        payload: { message: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      state.abortController = undefined;
    }
  }

  private handleChatAbort(state: ConnectionState, msg: WSMessage): void {
    if (state.abortController && state.sessionId === msg.sessionId) {
      state.abortController.abort();
      this.logger.info(`Chat aborted: ${msg.sessionId}`);
    }
  }

  private handleSessionSubscribe(state: ConnectionState, msg: WSMessage): void {
    if (msg.sessionId) {
      state.sessionId = msg.sessionId;
      state.conn.send({ type: 'session.subscribed', sessionId: msg.sessionId });
    }
  }
}
