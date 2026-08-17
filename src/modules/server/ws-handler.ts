// src/modules/server/ws-handler.ts
// WebSocket 消息分发：处理前端 WS 消息，转发 Agent 事件到客户端。

import { t } from '../../core/i18n';
import type { Logger, ServiceRegistry } from '../../core/types';
import { ServiceNames } from '../../core/types';
import type { WSMessage, WSMessageHandler, WSConnection } from './types';
import type { AgentEngine, AgentEvent } from '../contracts';
import type { AutomationService } from '../automation';
import { ErrorCode } from '../../core/error-codes';

interface ConnectionState {
  conn: WSConnection;
  sessionId?: string;
  /** 当前正在运行的 agent.run 的 AbortController，按 sessionId 索引（支持同连接多会话并发流） */
  activeRuns: Map<string, AbortController>;
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
    this.states.set(conn.id, { conn, activeRuns: new Map() });
    this.logger.debug(t('server.wsConnected', { id: conn.id }));
  }

  /** 移除连接 */
  unregisterConnection(id: string): void {
    const state = this.states.get(id);
    if (state) {
      for (const controller of state.activeRuns.values()) {
        controller.abort();
      }
      state.activeRuns.clear();
    }
    this.states.delete(id);
    this.logger.debug(t('server.wsDisconnected', { id }));
  }

  /** 处理来自客户端的消息 */
  async handleMessage(connId: string, raw: string): Promise<void> {
    const state = this.states.get(connId);
    if (!state) return;

    let msg: WSMessage;
    try {
      msg = JSON.parse(raw) as WSMessage;
    } catch {
      state.conn.send({ type: 'error', payload: { message: ErrorCode.WS_INVALID_JSON } });
      return;
    }

    // 1. 通知注册的 handler
    for (const h of this.messageHandlers) {
      try {
        await h(msg);
      } catch (err) {
        this.logger.error(t('server.wsHandlerFailed'), {
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
      case 'tool.confirm.reply':
        return this.handleConfirmReply(state, msg);
      case 'task.create':
        return this.handleTaskCreate(state, msg);
      case 'task.switch':
        return this.handleTaskSwitch(state, msg);
      case 'automation.run':
        return this.handleAutomationRun(state, msg);
      case 'ping':
        // 前端心跳探活，回 pong 确认连接存活
        state.conn.send({ type: 'pong' });
        return;
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
      state.conn.send({ type: 'error', sessionId: msg.sessionId, payload: { message: ErrorCode.WS_AGENT_ENGINE_UNAVAILABLE } });
      return;
    }

    const payload = (msg.payload ?? {}) as {
      message?: string;
      model?: string;
      cwd?: string;
      runId?: string;
      agentId?: string;
      /** skill 模式（/ 菜单触发）：非空=激活/切换；null=退出；缺省=不涉及 */
      skill?: string | null;
      /** 权限模式（前端 PermissionModeSelector 会话级传递）：ask/auto/skip；缺省=会话记忆/全局默认 */
      permissionMode?: 'ask' | 'auto' | 'skip';
    };

    if (!payload.message) {
      state.conn.send({ type: 'error', sessionId: msg.sessionId, payload: { message: ErrorCode.WS_MESSAGE_REQUIRED } });
      return;
    }

    const sessionId = msg.sessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    state.sessionId = sessionId;
    const runId = payload.runId;

    // 中断控制（按 sessionId 记录，支持并发流各自独立中断）
    const abortController = new AbortController();
    state.activeRuns.set(sessionId, abortController);

    const onEvent = (event: AgentEvent) => {
      state.conn.send({ type: event.type, sessionId: event.sessionId, payload: { ...event, runId } });
    };

    try {
      const result = await agent.run({
        sessionId,
        userMessage: payload.message,
        model: payload.model,
        agentId: payload.agentId,
        cwd: payload.cwd || process.cwd(),
        onEvent,
        signal: abortController.signal,
        runId,
        // skill 模式透传：undefined=不涉及；string=激活/切换；null=退出
        skill: payload.skill,
        // 权限模式透传（会话级；缺省时 engine 回退会话记忆/全局默认）
        permissionMode: payload.permissionMode,
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
      // 仅当当前记录的仍是自己时才清除，避免误清新流的 controller
      if (state.activeRuns.get(sessionId) === abortController) {
        state.activeRuns.delete(sessionId);
      }
    }
  }

  private handleTaskAbort(state: ConnectionState, msg: WSMessage): void {
    const controller = state.activeRuns.get(msg.sessionId ?? '');
    if (controller) {
      controller.abort();
      this.logger.info(t('server.taskAborted', { sessionId: msg.sessionId ?? '' }));
    }
  }

  private handleSessionSubscribe(state: ConnectionState, msg: WSMessage): void {
    if (msg.sessionId) {
      state.sessionId = msg.sessionId;
      state.conn.send({ type: 'session.subscribed', sessionId: msg.sessionId });

      // WS 重连恢复 pending asks：查询该 session 的待答列表，逐条发送 ask 事件（携带完整提问载荷），
      // 前端 useWebSocket 的 ask 处理器会将其加入 store.pendingAsks。
      const agent = this.services.tryResolve<AgentEngine & {
        getPendingAsks?: (sessionId: string) => Array<{
          toolCallId: string;
          sessionId: string;
          payload: { question: string; answerType?: string; options?: Array<{ value: string; label: string }>; defaultAnswer?: string };
        }>;
        getPendingConfirms?: (sessionId: string) => Array<{
          toolCallId: string;
          sessionId: string;
          question: string;
          ruleSuggestion?: string;
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
            question: ask.payload.question,
            answerType: ask.payload.answerType,
            options: ask.payload.options,
            defaultAnswer: ask.payload.defaultAnswer,
          },
        });
      }
      // WS 重连恢复 pending confirms：查询该 session 的待确认列表，逐条发送 confirm-required 事件（含规则建议）
      const confirms = agent?.getPendingConfirms?.(msg.sessionId) ?? [];
      for (const cf of confirms) {
        state.conn.send({
          type: 'confirm-required',
          sessionId: cf.sessionId,
          payload: {
            type: 'confirm-required',
            sessionId: cf.sessionId,
            toolCallId: cf.toolCallId,
            toolName: '',
            question: cf.question,
            ruleSuggestion: cf.ruleSuggestion,
          },
        });
      }
    }
  }

  /** 处理前端对 ask 工具的回复（accept=结构化回答 / cancel=取消提问） */
  private handleAskReply(state: ConnectionState, msg: WSMessage): void {
    const agent = this.services.tryResolve<AgentEngine>('agent.engine');
    if (!agent) {
      state.conn.send({ type: 'error', payload: { message: ErrorCode.WS_AGENT_ENGINE_UNAVAILABLE } });
      return;
    }
    const payload = (msg.payload ?? {}) as {
      toolCallId?: string;
      action?: 'accept' | 'cancel';
      answer?: {
        selectedValues?: string[];
        selectedLabels?: string[];
        editedLabels?: Record<string, string>;
        otherText?: string;
        text?: string;
      };
    };
    if (!payload.toolCallId || (payload.action !== 'accept' && payload.action !== 'cancel')) {
      state.conn.send({ type: 'error', payload: { message: ErrorCode.WS_TOOLCALLID_ANSWER_REQUIRED } });
      return;
    }
    if (payload.action === 'accept' && !payload.answer) {
      state.conn.send({ type: 'error', payload: { message: ErrorCode.WS_TOOLCALLID_ANSWER_REQUIRED } });
      return;
    }
    const ok = agent.resolveAsk(payload.toolCallId, {
      action: payload.action,
      ...(payload.action === 'accept' && payload.answer ? { answer: payload.answer } : {}),
    });
    if (!ok) {
      state.conn.send({
        type: 'error',
        payload: { message: ErrorCode.WS_NO_PENDING_ASK },
      });
      return;
    }
    state.conn.send({ type: 'tool.ask.accepted', toolCallId: payload.toolCallId });
  }

  /** 处理前端对 confirm 确认的回复 */
  private handleConfirmReply(state: ConnectionState, msg: WSMessage): void {
    const agent = this.services.tryResolve<AgentEngine>('agent.engine');
    if (!agent) {
      state.conn.send({ type: 'error', payload: { message: ErrorCode.WS_AGENT_ENGINE_UNAVAILABLE } });
      return;
    }
    const payload = (msg.payload ?? {}) as { toolCallId?: string; ok?: boolean; remember?: 'session' | 'global' };
    if (!payload.toolCallId || typeof payload.ok !== 'boolean') {
      state.conn.send({ type: 'error', payload: { message: ErrorCode.WS_TOOLCALLID_ANSWER_REQUIRED } });
      return;
    }
    const ok = agent.resolveConfirm(payload.toolCallId, payload.ok, payload.remember);
    if (!ok) {
      state.conn.send({
        type: 'error',
        payload: { message: ErrorCode.WS_NO_PENDING_ASK },
      });
      return;
    }
    state.conn.send({ type: 'tool.confirm.accepted', toolCallId: payload.toolCallId });
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
      state.conn.send({ type: 'error', payload: { message: ErrorCode.WS_CREATE_TASK_UNAVAILABLE } });
      return;
    }
    const payload = (msg.payload ?? {}) as { title?: string; groupId?: string };
    if (!payload.title || typeof payload.title !== 'string') {
      state.conn.send({ type: 'error', payload: { message: ErrorCode.WS_TITLE_REQUIRED } });
      return;
    }
    try {
      const task = agent.createTask(payload.title, payload.groupId);
      state.conn.send({ type: 'task.created', payload: { task } });
      this.logger.info(t('server.taskCreatedViaWs', { id: (task as { id?: string }).id ?? '' }));
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
      state.conn.send({ type: 'error', payload: { message: ErrorCode.WS_TASK_ID_REQUIRED } });
      return;
    }
    state.sessionId = taskId;
    state.conn.send({ type: 'session.subscribed', sessionId: taskId });
    this.logger.debug(t('server.wsTaskSwitched', { id: taskId }));
  }

  /**
   * 阶段5.2：处理 automation.run 入站消息。
   * 调 automation.trigger(id)，返回 automation.started。
   * automation 模块未加载时返回 error。
   */
  private handleAutomationRun(state: ConnectionState, msg: WSMessage): void {
    const automation = this.services.tryResolve<AutomationService>(ServiceNames.AUTOMATION_SERVICE);
    if (!automation) {
      state.conn.send({ type: 'error', payload: { message: ErrorCode.WS_AUTOMATION_SERVICE_UNAVAILABLE } });
      return;
    }
    const payload = (msg.payload ?? {}) as { automationId?: string };
    if (!payload.automationId) {
      state.conn.send({ type: 'error', payload: { message: ErrorCode.WS_AUTOMATION_ID_REQUIRED } });
      return;
    }
    try {
      const { runId } = automation.trigger(payload.automationId);
      state.conn.send({
        type: 'automation.started',
        payload: { automationId: payload.automationId, runId },
      });
      this.logger.info(t('server.automationTriggeredWs', { id: payload.automationId, runId }));
    } catch (err) {
      state.conn.send({
        type: 'error',
        payload: { message: err instanceof Error ? err.message : String(err) },
      });
    }
  }
}