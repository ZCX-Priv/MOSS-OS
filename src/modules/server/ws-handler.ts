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
  /** 最近一次订阅/操作的 session（兼容展示语义；事件投递以下方 subscribedSessions 为准） */
  sessionId?: string;
  /** 该连接订阅的全部 session：agent 事件按 sessionId 路由到所有订阅连接 */
  subscribedSessions: Set<string>;
}

/**
 * 高频流式事件合帧器：assistant-text / assistant-thinking / tool-call-delta
 * 按 key 拼接缓冲，30ms 定时冲刷（消息量从每 token 一条降到每秒 ~33 条）。
 * 保序：任何非缓冲事件发送前先 flush（见 WsHandler.sendEvent）；
 * 前端 useWebSocket 对这些类型为字符串累加语义，合帧天然兼容。
 */
const BATCH_INTERVAL_MS = 30;
/** 单 key 拼接上限：超过立即 flush（防极端大文本滞留缓冲） */
const BATCH_MAX_CHARS = 256 * 1024;

interface BatchedEvent {
  type: 'assistant-text' | 'assistant-thinking' | 'tool-call-delta';
  sessionId: string;
  runId?: string;
  /** assistant-text / assistant-thinking 拼接文本 */
  text?: string;
  /** tool-call-delta 专属 */
  toolCallId?: string;
  argumentsDelta?: string;
}

class EventBatcher {
  private readonly buffer = new Map<string, BatchedEvent>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushOut: (msg: Record<string, unknown>) => void;

  constructor(flushOut: (msg: Record<string, unknown>) => void) {
    this.flushOut = flushOut;
  }

  isBatchable(type: string): boolean {
    return type === 'assistant-text' || type === 'assistant-thinking' || type === 'tool-call-delta';
  }

  /** 缓冲一条高频事件（同 key 拼接 text / argumentsDelta） */
  push(msg: { type: string; sessionId: string; payload: Record<string, unknown> }): void {
    const p = msg.payload;
    const runId = typeof p.runId === 'string' ? p.runId : undefined;
    if (msg.type === 'tool-call-delta') {
      const toolCallId = String(p.toolCallId ?? '');
      const key = `${msg.sessionId}|d|${toolCallId}`;
      const delta = String(p.argumentsDelta ?? '');
      const existing = this.buffer.get(key);
      if (existing && existing.runId === runId) {
        existing.argumentsDelta = (existing.argumentsDelta ?? '') + delta;
      } else {
        this.buffer.set(key, {
          type: 'tool-call-delta', sessionId: msg.sessionId, runId, toolCallId, argumentsDelta: delta,
        });
      }
    } else {
      // 't' = text, 'k' = thinking（同轮 text 与 thinking 交替时不互相污染）
      const kind = msg.type === 'assistant-text' ? 't' : 'k';
      const key = `${msg.sessionId}|${kind}`;
      const text = String(p.text ?? '');
      const existing = this.buffer.get(key);
      if (existing && existing.runId === runId) {
        existing.text = (existing.text ?? '') + text;
      } else {
        this.buffer.set(key, { type: msg.type as BatchedEvent['type'], sessionId: msg.sessionId, runId, text });
      }
    }

    // 超限立即冲刷
    for (const e of this.buffer.values()) {
      if ((e.text ?? e.argumentsDelta ?? '').length > BATCH_MAX_CHARS) {
        this.flush();
        break;
      }
    }

    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, BATCH_INTERVAL_MS);
    }
  }

  /** 冲刷全部缓冲（保序：按插入顺序发送） */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.size === 0) return;
    const events = Array.from(this.buffer.values());
    this.buffer.clear();
    for (const e of events) {
      if (e.type === 'tool-call-delta') {
        this.flushOut({
          type: 'tool-call-delta',
          sessionId: e.sessionId,
          payload: {
            type: 'tool-call-delta',
            sessionId: e.sessionId,
            toolCallId: e.toolCallId,
            argumentsDelta: e.argumentsDelta ?? '',
            runId: e.runId,
          },
        });
      } else {
        this.flushOut({
          type: e.type,
          sessionId: e.sessionId,
          payload: { type: e.type, sessionId: e.sessionId, text: e.text ?? '', runId: e.runId },
        });
      }
    }
  }
}

export class WsHandler {
  private readonly states = new Map<string, ConnectionState>();
  private readonly messageHandlers: WSMessageHandler[] = [];
  private readonly logger: Logger;
  private readonly services: ServiceRegistry;
  /**
   * 运行中任务：sessionId → AbortController（handler 级，与连接解耦）。
   * WS 断连不再中止任务（弱网闪断/心跳重连曾直接杀死后台任务且前端无从感知——
   * 长程任务「回复/思考/工具调用卡死」的根因）；仅 task.abort 显式中断。
   */
  private readonly activeRuns = new Map<string, AbortController>();
  /** 引导消息数组（可变引用，传给 engine.run；handleTaskGuide 在运行期间向其 push 消息） */
  private readonly guideMessageArrays = new Map<string, string[]>();
  /** 引导消息对应的 runId 队列（前端为每条引导消息生成 runId，用于新 run 的事件隔离） */
  private readonly guideRunIds = new Map<string, string[]>();
  private readonly batcher: EventBatcher;

  constructor(services: ServiceRegistry, logger: Logger) {
    this.services = services;
    this.logger = logger;
    this.batcher = new EventBatcher((msg) => {
      this.sendToSubscribers(String(msg.sessionId), msg);
    });
  }

  onWSMessage(handler: WSMessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /** 注册新连接 */
  registerConnection(conn: WSConnection): void {
    this.states.set(conn.id, { conn, subscribedSessions: new Set() });
    this.logger.debug(t('server.wsConnected', { id: conn.id }));
  }

  /** 移除连接：只清订阅，不中止任务（任务与连接解耦，断连后继续跑，重连可恢复） */
  unregisterConnection(id: string): void {
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
      case 'task.guide':
        return this.handleTaskGuide(state, msg);
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

  /** 发送消息到指定 session 的全部订阅连接 */
  sendToSession(sessionId: string, message: unknown): void {
    this.sendToSubscribers(sessionId, message);
  }

  /** 注册外部发起的活跃 run（automation 等不经 task.stream 的运行）：
   *  session.subscribe/task.switch 的 running 判定包含该 session；task.abort 可中断。
   *  若该 session 已有活跃 run，语义与 task.stream 的「打断发送」一致：旧 run 被 abort 后自行收尾 */
  registerExternalRun(sessionId: string, controller: AbortController): void {
    const prevController = this.activeRuns.get(sessionId);
    this.activeRuns.set(sessionId, controller);
    if (prevController && prevController !== controller) {
      prevController.abort();
    }
  }

  /** 注销外部活跃 run（仅当注册的 controller 仍是当前活跃 run 时移除，防误删用户新 run） */
  unregisterExternalRun(sessionId: string, controller: AbortController): void {
    if (this.activeRuns.get(sessionId) === controller) {
      this.activeRuns.delete(sessionId);
    }
  }

  /** 发送消息到订阅该 session 的所有活跃连接（无订阅者时静默丢弃） */
  private sendToSubscribers(sessionId: string, message: unknown): void {
    const text = JSON.stringify(message);
    for (const state of this.states.values()) {
      if (state.subscribedSessions.has(sessionId)) {
        state.conn.send(text);
      }
    }
  }

  /**
   * 发送 agent 事件：高频流式类型进合帧缓冲，其余类型先冲刷缓冲再发（保序）。
   */
  private sendEvent(sessionId: string, msg: { type: string; sessionId: string; payload: Record<string, unknown> }): void {
    if (this.batcher.isBatchable(msg.type)) {
      this.batcher.push(msg);
    } else {
      this.batcher.flush();
      this.sendToSubscribers(sessionId, msg);
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
      /** 权限模式（前端 PermissionModeSelector 会话级传递）：ask/auto/skip；缺省=会话记忆/全局默认 */
      permissionMode?: 'ask' | 'auto' | 'skip';
    };

    if (!payload.message) {
      state.conn.send({ type: 'error', sessionId: msg.sessionId, payload: { message: ErrorCode.WS_MESSAGE_REQUIRED } });
      return;
    }

    const sessionId = msg.sessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    state.sessionId = sessionId;
    // 发起连接自动订阅该 session（事件按 session 路由；断连后任务继续，重连可恢复接收）
    state.subscribedSessions.add(sessionId);

    // 引导消息：可变数组引用，传给 engine.run()；handleTaskGuide 在运行期间向其 push 消息。
    // engine 在工具调用完成后检查此数组，若有内容则返回 guideInterrupt。
    let currentMessage = payload.message;
    let currentRunId = payload.runId;
    let currentGuideMessages: string[] = [];
    this.guideMessageArrays.set(sessionId, currentGuideMessages);

    while (true) {
      // 中断控制（handler 级，与连接解耦）。同 session 发起新 run 时中止旧 run：
      // 「打断发送」语义——旧 run 的残余事件由前端 runId 过滤丢弃
      const abortController = new AbortController();
      const prevController = this.activeRuns.get(sessionId);
      this.activeRuns.set(sessionId, abortController);
      if (prevController) {
        prevController.abort();
      }

      const onEvent = (event: AgentEvent) => {
        this.sendEvent(sessionId, {
          type: event.type,
          sessionId: event.sessionId,
          payload: { ...event, runId: currentRunId },
        });
      };

      try {
        const result = await agent.run({
          sessionId,
          userMessage: currentMessage,
          model: payload.model,
          agentId: payload.agentId,
          cwd: payload.cwd || process.cwd(),
          onEvent,
          signal: abortController.signal,
          runId: currentRunId,
          // 权限模式透传（会话级；缺省时 engine 回退会话记忆/全局默认）
          permissionMode: payload.permissionMode,
          // 引导消息数组（可变引用，运行期间 handleTaskGuide 可向其 push）
          guideMessages: currentGuideMessages,
        });

        // 引导中断：engine 在工具调用完成后检测到引导消息，主动中止并返回
        if (result.guideInterrupt && result.guideMessage) {
          // 移除已被 engine 消费的消息（engine 取 guideMessages[0]）
          if (currentGuideMessages.length > 0) {
            currentGuideMessages.shift();
          }
          // 发送旧 run 的 task.done，前端据此结束旧 run 的流式状态
          this.sendEvent(sessionId, {
            type: 'task.done',
            sessionId: result.sessionId,
            payload: { finishReason: 'aborted', finalText: result.finalText, runId: currentRunId },
          });
          // 取前端为引导消息生成的 runId（若无则随机）
          const runIdArr = this.guideRunIds.get(sessionId);
          currentRunId = runIdArr?.shift() ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          if (runIdArr && runIdArr.length === 0) {
            this.guideRunIds.delete(sessionId);
          }
          currentMessage = result.guideMessage;
          // 复用同一 guideMessages 数组，剩余引导消息在新 run 中继续被检测
          continue;
        }

        // 正常完成：检查是否有迟到的引导消息（engine 最后一轮未检测到）
        if (!abortController.signal.aborted && currentGuideMessages.length > 0) {
          const guideMsg = currentGuideMessages.shift()!;
          this.sendEvent(sessionId, {
            type: 'task.done',
            sessionId: result.sessionId,
            payload: { finishReason: result.finishReason, finalText: result.finalText, runId: currentRunId },
          });
          const runIdArr = this.guideRunIds.get(sessionId);
          currentRunId = runIdArr?.shift() ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          if (runIdArr && runIdArr.length === 0) {
            this.guideRunIds.delete(sessionId);
          }
          currentMessage = guideMsg;
          continue;
        }

        if (abortController.signal.aborted) {
          this.sendEvent(sessionId, { type: 'task.aborted', sessionId: result.sessionId, payload: { runId: currentRunId } });
        } else {
          this.sendEvent(sessionId, {
            type: 'task.done',
            sessionId: result.sessionId,
            payload: {
              finishReason: result.finishReason,
              finalText: result.finalText,
              runId: currentRunId,
            },
          });
        }
        break;
      } catch (err) {
        if (abortController.signal.aborted) {
          this.sendEvent(sessionId, { type: 'task.aborted', sessionId, payload: { runId: currentRunId } });
        } else {
          this.sendEvent(sessionId, {
            type: 'error',
            sessionId,
            payload: { message: err instanceof Error ? err.message : String(err), runId: currentRunId },
          });
        }
        break;
      } finally {
        // 仅当当前记录的仍是自己时才清除，避免误清新流的 controller
        if (this.activeRuns.get(sessionId) === abortController) {
          this.activeRuns.delete(sessionId);
        }
        // 冲净残余缓冲（保序收尾）
        this.batcher.flush();
      }
    }

    // 清理引导消息相关状态
    this.guideMessageArrays.delete(sessionId);
    this.guideRunIds.delete(sessionId);
  }

  /**
   * 处理引导模式消息：将消息推入当前 run 的 guideMessages 数组。
   * engine 在工具调用完成后检查此数组，若有内容则中止当前 run 并返回 guideInterrupt，
   * 随后 handleTaskStream 的 while 循环自动用引导消息启动新 run。
   */
  private handleTaskGuide(_state: ConnectionState, msg: WSMessage): void {
    const sessionId = msg.sessionId;
    if (!sessionId) return;

    const payload = (msg.payload ?? {}) as { message?: string; runId?: string };
    if (!payload.message) return;

    const guideArr = this.guideMessageArrays.get(sessionId);
    if (guideArr !== undefined) {
      guideArr.push(payload.message);
      if (payload.runId) {
        const runIds = this.guideRunIds.get(sessionId) ?? [];
        runIds.push(payload.runId);
        this.guideRunIds.set(sessionId, runIds);
      }
    } else {
      this.logger.warn(`Guide message received but no active run for session ${sessionId}`);
    }
  }

  private handleTaskAbort(_state: ConnectionState, msg: WSMessage): void {
    const controller = this.activeRuns.get(msg.sessionId ?? '');
    if (controller) {
      controller.abort();
      this.logger.info(t('server.taskAborted', { sessionId: msg.sessionId ?? '' }));
    }
  }

  private handleSessionSubscribe(state: ConnectionState, msg: WSMessage): void {
    if (msg.sessionId) {
      state.sessionId = msg.sessionId;
      state.subscribedSessions.add(msg.sessionId);
      // running：该 session 是否仍有任务在跑（前端重连后据此校正 generating 状态——
      // 任务与连接解耦后，断连期间任务可能已完成，最终消息需拉历史恢复）
      state.conn.send({
        type: 'session.subscribed',
        sessionId: msg.sessionId,
        payload: { running: this.activeRuns.has(msg.sessionId) },
      });

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
    state.subscribedSessions.add(taskId);
    state.conn.send({
      type: 'session.subscribed',
      sessionId: taskId,
      payload: { running: this.activeRuns.has(taskId) },
    });
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