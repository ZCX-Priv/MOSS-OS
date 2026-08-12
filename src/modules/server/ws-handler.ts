// src/plugins/server/ws-handler.ts
// WebSocket 消息分发：处理前端 WS 消息，转发 Agent 事件到客户端。

import type { Logger, ServiceRegistry } from '../../core/types';
import { ServiceNames } from '../../core/types';
import type { WSMessage, WSMessageHandler, WSConnection } from './types';
import type { AgentEngine, AgentEvent } from '../contracts';
import type { AutomationService } from '../automation';

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
      case 'task.stream':
        return this.handleTaskStream(state, msg);
      case 'task.abort':
        return this.handleTaskAbort(state, msg);
      case 'session.subscribe':
        return this.handleSessionSubscribe(state, msg);
      case 'tool.ask.reply':
        return this.handleAskReply(state, msg);
      case 'task.create':
        return this.handleTaskCreate(state, msg);
      case 'task.switch':
        return this.handleTaskSwitch(state, msg);
      case 'automation.run':
        return this.handleAutomationRun(state, msg);
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

  private async handleTaskStream(state: ConnectionState, msg: WSMessage): Promise<void> {
    const agent = this.services.tryResolve<AgentEngine>('agent.engine');
    if (!agent) {
      state.conn.send({ type: 'error', sessionId: msg.sessionId, payload: { message: 'Agent engine not available' } });
      return;
    }

    const payload = (msg.payload ?? {}) as {
      message?: string;
      model?: string;
      cwd?: string;
      runId?: string;
    };

    if (!payload.message) {
      state.conn.send({ type: 'error', sessionId: msg.sessionId, payload: { message: 'message required' } });
      return;
    }

    const sessionId = msg.sessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    state.sessionId = sessionId;
    const runId = payload.runId;

    // 中断控制
    const abortController = new AbortController();
    state.abortController = abortController;

    const onEvent = (event: AgentEvent) => {
      state.conn.send({ type: event.type, sessionId: event.sessionId, payload: { ...event, runId } });
    };

    try {
      const result = await agent.run({
        sessionId,
        userMessage: payload.message,
        model: payload.model,
        cwd: payload.cwd || process.cwd(),
        onEvent,
        signal: abortController.signal,
        runId,
      });

      if (abortController.signal.aborted) {
        state.conn.send({ type: 'task.aborted', sessionId: result.sessionId, payload: { runId } });
      } else {
        state.conn.send({
          type: 'task.done',
          sessionId: result.sessionId,
          payload: {
            finishReason: result.finishReason,
            finalText: result.finalText,
            runId,
          },
        });
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        state.conn.send({ type: 'task.aborted', sessionId, payload: { runId } });
      } else {
        state.conn.send({
          type: 'error',
          sessionId,
          payload: { message: err instanceof Error ? err.message : String(err), runId },
        });
      }
    } finally {
      // 仅当当前 controller 仍是自己时才清除，避免打断发送时误清新流的 controller
      if (state.abortController === abortController) {
        state.abortController = undefined;
      }
    }
  }

  private handleTaskAbort(state: ConnectionState, msg: WSMessage): void {
    if (state.abortController && state.sessionId === msg.sessionId) {
      state.abortController.abort();
      this.logger.info(`Task aborted: ${msg.sessionId}`);
    }
  }

  private handleSessionSubscribe(state: ConnectionState, msg: WSMessage): void {
    if (msg.sessionId) {
      state.sessionId = msg.sessionId;
      state.conn.send({ type: 'session.subscribed', sessionId: msg.sessionId });

      // WS 重连恢复 pending asks：查询该 session 的待答列表，逐条发送 ask 事件，
      // 前端 useWebSocket 的 ask 处理器会将其加入 store.pendingAsks。
      const agent = this.services.tryResolve<AgentEngine & {
        getPendingAsks?: (sessionId: string) => Array<{
          toolCallId: string;
          sessionId: string;
          question: string;
        }>;
      }>('agent.engine');
      const asks = agent?.getPendingAsks?.(msg.sessionId) ?? [];
      for (const ask of asks) {
        state.conn.send({
          type: 'ask',
          sessionId: ask.sessionId,
          payload: {
            type: 'ask',
            sessionId: ask.sessionId,
            toolCallId: ask.toolCallId,
            question: ask.question,
          },
        });
      }
    }
  }

  /** 处理前端对 ask 工具的回复 */
  private handleAskReply(state: ConnectionState, msg: WSMessage): void {
    const agent = this.services.tryResolve<AgentEngine>('agent.engine');
    if (!agent) {
      state.conn.send({ type: 'error', payload: { message: 'Agent engine not available' } });
      return;
    }
    const payload = (msg.payload ?? {}) as { toolCallId?: string; answer?: string };
    if (!payload.toolCallId || typeof payload.answer !== 'string') {
      state.conn.send({ type: 'error', payload: { message: 'toolCallId and answer required' } });
      return;
    }
    const ok = agent.resolveAsk(payload.toolCallId, payload.answer);
    if (!ok) {
      state.conn.send({
        type: 'error',
        payload: { message: `No pending ask for toolCallId=${payload.toolCallId}` },
      });
      return;
    }
    state.conn.send({ type: 'tool.ask.accepted', toolCallId: payload.toolCallId });
  }

  /**
   * 阶段5.2：处理 task.create 入站消息。
   * 调 agent.createTask 创建任务，返回 task.created。
   * TaskItem.id 即 sessionId（计划假设3），前端可直接用该 id 订阅 session。
   */
  private handleTaskCreate(state: ConnectionState, msg: WSMessage): void {
    const agent = this.services.tryResolve<AgentEngine & {
      createTask?: (title: string, groupId?: string) => unknown;
    }>(ServiceNames.AGENT_ENGINE);
    if (!agent?.createTask) {
      state.conn.send({ type: 'error', payload: { message: 'Agent engine createTask not available' } });
      return;
    }
    const payload = (msg.payload ?? {}) as { title?: string; groupId?: string };
    if (!payload.title || typeof payload.title !== 'string') {
      state.conn.send({ type: 'error', payload: { message: 'title required' } });
      return;
    }
    try {
      const task = agent.createTask(payload.title, payload.groupId);
      state.conn.send({ type: 'task.created', payload: { task } });
      this.logger.info(`Task created via WS: ${(task as { id?: string }).id ?? ''}`);
    } catch (err) {
      state.conn.send({
        type: 'error',
        payload: { message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  /**
   * 阶段5.2：处理 task.switch 入站消息。
   * 设置 state.sessionId 为 task 对应 sessionId，返回 session.subscribed。
   * TaskItem.id 即 sessionId（计划假设3）。
   */
  private handleTaskSwitch(state: ConnectionState, msg: WSMessage): void {
    const payload = (msg.payload ?? {}) as { taskId?: string };
    const taskId = payload.taskId ?? msg.sessionId;
    if (!taskId) {
      state.conn.send({ type: 'error', payload: { message: 'taskId required' } });
      return;
    }
    state.sessionId = taskId;
    state.conn.send({ type: 'session.subscribed', sessionId: taskId });
    this.logger.debug(`WS task switched: ${taskId}`);
  }

  /**
   * 阶段5.2：处理 automation.run 入站消息。
   * 调 automation.trigger(id)，返回 automation.started。
   * automation 模组未加载时返回 error。
   */
  private handleAutomationRun(state: ConnectionState, msg: WSMessage): void {
    const automation = this.services.tryResolve<AutomationService>(ServiceNames.AUTOMATION_SERVICE);
    if (!automation) {
      state.conn.send({ type: 'error', payload: { message: 'Automation service not available' } });
      return;
    }
    const payload = (msg.payload ?? {}) as { automationId?: string };
    if (!payload.automationId) {
      state.conn.send({ type: 'error', payload: { message: 'automationId required' } });
      return;
    }
    try {
      const { runId } = automation.trigger(payload.automationId);
      state.conn.send({
        type: 'automation.started',
        payload: { automationId: payload.automationId, runId },
      });
      this.logger.info(`Automation triggered via WS: ${payload.automationId} (run ${runId})`);
    } catch (err) {
      state.conn.send({
        type: 'error',
        payload: { message: err instanceof Error ? err.message : String(err) },
      });
    }
  }
}
