// UI/src/hooks/useWebSocket.ts
// WS 连接初始化 + 事件分发单例 hook。
// 只应在应用根组件（App.tsx）调用一次，重复调用会导致同一事件被多次处理。
//
// 职责：
// 1. 挂载时建立 wsClient 连接，卸载时断开。
// 2. 订阅 onStatus → setWsStatus。
// 3. 订阅 onMessage → 按类型分发到 store：
//    - assistant-text / assistant-thinking：累积到当前流式 assistant 消息
//    - tool-call-start / tool-call-end：附加工具调用与结果
//    - ask：加入 pendingAsks
//    - done / task.done：结束流式，清生成态
//    - error：写入错误消息，清生成态
//    - session.subscribed：设置 activeSessionId
//    - tool.ask.accepted：移除 pendingAsk
//    - todo-updated：setTodos
//    - context-updated：setContext
//    - file-created / file-edited：toast 提示（预留）
//    - task.created / task.updated：更新 tasks
//    - automation.started / automation.finished：更新 history
//    - config.changed：标记需刷新配置（由 useConfig 订阅 store 触发重拉）
//    - extension.changed：标记需刷新插件（由 usePlugins 订阅触发重拉）

import { useEffect } from 'react';
import { toast } from 'sonner';
import { useStore } from '../store';
import { wsClient } from '../api/ws';
import { pendingAssistant, pendingRunId } from '../lib/pending-assistant';
import i18n from '../i18n';
import type {
  AgentEvent,
  TaskMessage,
  TaskItem,
  TodoItem,
  ContextFile,
  AutomationRun,
  WSMessage,
  ToolCall,
} from '../types/api';

function genId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// 需要做 runId 过滤的 agent 事件类型
const AGENT_EVENT_TYPES = new Set([
  'assistant-text', 'assistant-thinking',
  'tool-call-start', 'tool-call-delta', 'tool-call-executing', 'tool-call-end',
  'ask', 'error', 'done', 'task.done', 'task.aborted',
]);

// ============================================================================
// 批处理缓冲区：对高频流式事件（assistant-text / assistant-thinking / tool-call-delta）
// 用 requestAnimationFrame 合并，避免每条事件都同步触发 store.set()，从而饿死路由切换渲染。
// 低频事件（tool-call-start/end/executing、done、error 等）执行前会先 flushPending()，保证顺序。
// ============================================================================
interface PendingTextAppend {
  sessionId: string;
  messageId: string;
  field: 'content' | 'thinking';
  text: string;
  thinkingStreaming: boolean;
}
interface PendingToolDelta {
  sessionId: string;
  messageId: string;
  toolCallId: string;
  argumentsDelta: string;
}

const pendingTextMap = new Map<string, PendingTextAppend>();
const pendingToolDeltaMap = new Map<string, PendingToolDelta>();
let rafId: number | null = null;

function scheduleFlush(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    flushPending();
  });
}

function flushPending(): void {
  // 1. 刷新文本缓冲：每组（sessionId|messageId|field）一次 store 更新
  if (pendingTextMap.size > 0) {
    const entries = Array.from(pendingTextMap.values());
    pendingTextMap.clear();
    for (const op of entries) {
      useStore.getState().appendTextAndMarkThinking(
        op.sessionId, op.messageId, op.field, op.text, op.thinkingStreaming,
      );
    }
  }
  // 2. 刷新 tool-call-delta 缓冲：按 sessionId|messageId 分组，合并 delta 后一次 updateMessage
  if (pendingToolDeltaMap.size > 0) {
    const entries = Array.from(pendingToolDeltaMap.values());
    pendingToolDeltaMap.clear();
    const grouped = new Map<string, { sessionId: string; messageId: string; deltas: Map<string, string> }>();
    for (const op of entries) {
      const key = `${op.sessionId}|${op.messageId}`;
      let g = grouped.get(key);
      if (!g) {
        g = { sessionId: op.sessionId, messageId: op.messageId, deltas: new Map() };
        grouped.set(key, g);
      }
      g.deltas.set(op.toolCallId, (g.deltas.get(op.toolCallId) ?? '') + op.argumentsDelta);
    }
    for (const g of grouped.values()) {
      const pending = pendingAssistant.get(g.sessionId);
      if (!pending?.toolCalls) continue;
      const updatedToolCalls = pending.toolCalls.map((tc) => {
        const delta = g.deltas.get(tc.id);
        return delta ? { ...tc, arguments: tc.arguments + delta } : tc;
      });
      useStore.getState().updateMessage(g.sessionId, g.messageId, { toolCalls: updatedToolCalls });
      pendingAssistant.set(g.sessionId, { ...pending, toolCalls: updatedToolCalls });
    }
  }
}

export function useWebSocket(): void {
  useEffect(() => {
    // 1. 建立连接
    wsClient.connect();
    const unsubStatus = wsClient.onStatus((status) => {
      useStore.getState().setWsStatus(status);
    });

    // 2. 订阅消息
    const unsubMessage = wsClient.onMessage((msg: WSMessage) => {
      handleMessage(msg);
    });

    return () => {
      unsubStatus();
      unsubMessage();
      wsClient.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------------
  // 消息分发：读取最新 store（避免闭包陈旧）
  // ------------------------------------------------------------------------
  function handleMessage(msg: WSMessage): void {
    const s = useStore.getState();
    const sessionId = msg.sessionId ?? s.activeSessionId ?? '';

    // runId 过滤：丢弃旧 run 的事件（防止打断发送时旧流事件污染新流状态）
    if (sessionId && AGENT_EVENT_TYPES.has(msg.type)) {
      const eventRunId = (msg.payload as { runId?: string })?.runId;
      const currentRunId = pendingRunId.get(sessionId);
      if (eventRunId && currentRunId && eventRunId !== currentRunId) return;
    }

    switch (msg.type) {
      // ====================================================================
      // Agent 事件流（payload 为完整 AgentEvent）
      // ====================================================================
      case 'assistant-text': {
        if (!sessionId) return;
        const event = msg.payload as Extract<AgentEvent, { type: 'assistant-text' }>;
        const pending = ensurePendingAssistant(sessionId);
        // 缓冲文本 append（rAF 批处理），避免每 token 同步触发 2 次 store.set()
        const key = `${sessionId}|${pending.id}|content`;
        const existing = pendingTextMap.get(key);
        if (existing) {
          existing.text += event.text;
          existing.thinkingStreaming = false;
        } else {
          pendingTextMap.set(key, {
            sessionId, messageId: pending.id, field: 'content',
            text: event.text, thinkingStreaming: false,
          });
        }
        scheduleFlush();
        break;
      }
      case 'assistant-thinking': {
        if (!sessionId) return;
        const event = msg.payload as Extract<AgentEvent, { type: 'assistant-thinking' }>;
        const pending = ensurePendingAssistant(sessionId);
        const key = `${sessionId}|${pending.id}|thinking`;
        const existing = pendingTextMap.get(key);
        if (existing) {
          existing.text += event.text;
          existing.thinkingStreaming = true;
        } else {
          pendingTextMap.set(key, {
            sessionId, messageId: pending.id, field: 'thinking',
            text: event.text, thinkingStreaming: true,
          });
        }
        scheduleFlush();
        break;
      }
      case 'tool-call-start': {
        flushPending(); // 确保之前的文本/delta 已写入，避免顺序错乱
        const event = msg.payload as Extract<AgentEvent, { type: 'tool-call-start' }>;
        if (!sessionId) break;
        const pending = ensurePendingAssistant(sessionId);
        // 即时写入 store，status='generating'
        const newToolCall: ToolCall = {
          id: event.toolCallId,
          name: event.toolName,
          arguments: '',
          status: 'generating',
        };
        const updatedToolCalls = [...(pending.toolCalls ?? []), newToolCall];
        s.updateMessage(sessionId, pending.id, { toolCalls: updatedToolCalls, thinkingStreaming: false });
        pendingAssistant.set(sessionId, { ...pending, toolCalls: updatedToolCalls });
        break;
      }
      case 'tool-call-delta': {
        const event = msg.payload as Extract<AgentEvent, { type: 'tool-call-delta' }>;
        if (!sessionId) break;
        const pending = pendingAssistant.get(sessionId);
        if (!pending?.toolCalls) break;
        // 缓冲 delta（rAF 批处理），避免每参数片段同步触发 store.set()
        const key = `${sessionId}|${event.toolCallId}`;
        const existing = pendingToolDeltaMap.get(key);
        if (existing) {
          existing.argumentsDelta += event.argumentsDelta;
        } else {
          pendingToolDeltaMap.set(key, {
            sessionId, messageId: pending.id, toolCallId: event.toolCallId,
            argumentsDelta: event.argumentsDelta,
          });
        }
        scheduleFlush();
        break;
      }
      case 'tool-call-executing': {
        flushPending(); // 确保之前的 delta 已写入
        const event = msg.payload as Extract<AgentEvent, { type: 'tool-call-executing' }>;
        if (!sessionId) break;
        const pending = pendingAssistant.get(sessionId);
        if (!pending?.toolCalls) break;
        const updatedToolCalls = pending.toolCalls.map((tc) =>
          tc.id === event.toolCallId ? { ...tc, status: 'executing' as const } : tc,
        );
        s.updateMessage(sessionId, pending.id, { toolCalls: updatedToolCalls });
        pendingAssistant.set(sessionId, { ...pending, toolCalls: updatedToolCalls });
        break;
      }
      case 'tool-call-end': {
        flushPending(); // 确保之前的 delta 已写入，避免 end 后还有残余 delta
        const event = msg.payload as Extract<AgentEvent, { type: 'tool-call-end' }>;
        if (!sessionId) break;
        const pending = pendingAssistant.get(sessionId);
        if (!pending?.toolCalls) break;
        const updatedToolCalls = pending.toolCalls.map((tc) =>
          tc.id === event.toolCallId
            ? { ...tc, name: event.toolName, status: 'done' as const }
            : tc,
        );
        const updatedToolResults = [
          ...(pending.toolResults ?? []),
          { toolCallId: event.toolCallId, result: event.result },
        ];
        s.updateMessage(sessionId, pending.id, {
          toolCalls: updatedToolCalls,
          toolResults: updatedToolResults,
        });
        pendingAssistant.set(sessionId, {
          ...pending,
          toolCalls: updatedToolCalls,
          toolResults: updatedToolResults,
        });
        break;
      }
      case 'ask': {
        if (!sessionId) return;
        const event = msg.payload as Extract<AgentEvent, { type: 'ask' }>;
        s.addPendingAsk({
          toolCallId: event.toolCallId,
          sessionId,
          question: event.question,
          createdAt: Date.now(),
        });
        break;
      }
      case 'error': {
        flushPending(); // 确保流式文本在终止前全部写入
        const event = (msg.payload ?? {}) as { message?: string };
        const errorCode = event.message ?? '';
        const localizedMessage = i18n.exists(`errors.${errorCode}`) ? i18n.t(`errors.${errorCode}`) : (errorCode || i18n.t('errors.UNKNOWN'));
        if (sessionId) {
          s.addMessage(sessionId, {
            id: genId(),
            role: 'assistant',
            content: localizedMessage,
            isError: true,
            timestamp: new Date().toISOString(),
          });
          s.setGenerating(sessionId, false);
          pendingAssistant.delete(sessionId);
        }
        toast.error(localizedMessage);
        break;
      }
      case 'done': {
        flushPending(); // 确保流式文本在终止前全部写入
        if (sessionId) {
          const pending = pendingAssistant.get(sessionId);
          if (pending) {
            // 兜底：将未完成的 toolCall 标记为 done（abort 场景下 tool-call-end 不会到达）
            const finalizedToolCalls = pending.toolCalls?.map((tc) =>
              tc.status === 'done' ? tc : { ...tc, status: 'done' as const },
            );
            s.updateMessage(sessionId, pending.id, { streaming: false, thinkingStreaming: false, toolCalls: finalizedToolCalls });
            pendingAssistant.delete(sessionId);
          }
          s.setGenerating(sessionId, false);
          // agent.run 结束，后端兜底 reject 未完成的 ask；前端清空该 session 的待答提问
          useStore.getState().clearPendingAsksBySession(sessionId);
        }
        break;
      }
      case 'task.done': {
        flushPending(); // 确保流式文本在终止前全部写入
        if (sessionId) {
          const pending = pendingAssistant.get(sessionId);
          if (pending) {
            const finalizedToolCalls = pending.toolCalls?.map((tc) =>
              tc.status === 'done' ? tc : { ...tc, status: 'done' as const },
            );
            s.updateMessage(sessionId, pending.id, { streaming: false, thinkingStreaming: false, toolCalls: finalizedToolCalls });
            pendingAssistant.delete(sessionId);
          }
          s.setGenerating(sessionId, false);
        }
        break;
      }
      case 'task.aborted': {
        flushPending(); // 确保流式文本在终止前全部写入
        // 用户主动中断（停止按钮 / 打断发送）。
        // 仅清理流式消息状态，不写 Error 消息、不改 generating：
        // - 停止按钮场景：useTask.abort 已 setGenerating(false)
        // - 打断发送场景：sendMessage 已 setGenerating(true) 启动新流
        if (sessionId) {
          const pending = pendingAssistant.get(sessionId);
          if (pending) {
            const finalizedToolCalls = pending.toolCalls?.map((tc) =>
              tc.status === 'done' ? tc : { ...tc, status: 'done' as const },
            );
            s.updateMessage(sessionId, pending.id, { streaming: false, thinkingStreaming: false, toolCalls: finalizedToolCalls });
            pendingAssistant.delete(sessionId);
          }
        }
        break;
      }

      // ====================================================================
      // 会话订阅
      // ====================================================================
      case 'session.subscribed': {
        if (sessionId) useStore.getState().setActiveSession(sessionId);
        break;
      }
      case 'tool.ask.accepted': {
        const toolCallId = (msg as { toolCallId?: string }).toolCallId;
        if (toolCallId) useStore.getState().removePendingAsk(toolCallId);
        break;
      }

      // ====================================================================
      // 阶段5 新增事件分发（后端增强后推送）
      // ====================================================================
      case 'todo-updated': {
        if (!sessionId) break;
        const payload = (msg.payload ?? {}) as { todos?: TodoItem[]; toolCallId?: string };
        if (payload.todos) {
          useStore.getState().setTodos(sessionId, payload.todos);
          // 回填快照到发起这次 todo 调用的 message，使任务流内卡片按调用时刻渲染
          if (payload.toolCallId) {
            const msgs = useStore.getState().messagesBySession[sessionId] ?? [];
            const target = msgs.find((m) => m.toolCalls?.some((tc) => tc.id === payload.toolCallId));
            if (target) {
              useStore.getState().updateMessage(sessionId, target.id, { todoSnapshot: payload.todos });
            }
          }
        }
        break;
      }
      case 'context-updated': {
        if (!sessionId) break;
        const payload = (msg.payload ?? {}) as {
          files?: ContextFile[];
          totalTokens?: number;
          maxTokens?: number;
        };
        useStore.getState().setContext(sessionId, {
          files: payload.files ?? [],
          totalTokens: payload.totalTokens ?? 0,
          maxTokens: payload.maxTokens ?? 0,
        });
        break;
      }
      case 'file-created': {
        const payload = (msg.payload ?? {}) as { path?: string };
        if (payload.path) toast.success(`已创建文件: ${payload.path}`);
        break;
      }
      case 'file-edited': {
        const payload = (msg.payload ?? {}) as { path?: string };
        if (payload.path) toast.success(`已编辑文件: ${payload.path}`);
        break;
      }
      case 'task.created': {
        const payload = (msg.payload ?? {}) as { task?: TaskItem };
        if (payload.task) useStore.getState().addTask(payload.task);
        break;
      }
      case 'task.updated': {
        const payload = (msg.payload ?? {}) as { task?: TaskItem };
        if (payload.task) {
          useStore.getState().updateTask(payload.task.id, payload.task);
        }
        break;
      }
      case 'automation.started': {
        const payload = (msg.payload ?? {}) as { run?: AutomationRun };
        if (payload.run) {
          useStore.getState().addAutomationRun(payload.run.automationId, payload.run);
          useStore.getState().updateAutomation(payload.run.automationId, {
            lastRunAt: payload.run.startedAt,
          });
        }
        break;
      }
      case 'automation.finished': {
        const payload = (msg.payload ?? {}) as { run?: AutomationRun };
        if (payload.run) {
          useStore.getState().updateAutomationRun(
            payload.run.automationId,
            payload.run.id,
            {
              finishedAt: payload.run.finishedAt,
              status: payload.run.status,
              finishReason: payload.run.finishReason,
              finalText: payload.run.finalText,
              error: payload.run.error,
            },
          );
        }
        break;
      }
      case 'config.changed': {
        // 配置已变更；具体重拉由 useConfig hook 独立订阅 wsClient.onMessage 触发。
        // 此处不重复处理，避免与 useConfig 的 loadConfig 竞态。
        break;
      }
      case 'extension.changed': {
        // 扩展状态已变更；具体重拉由 usePlugins hook 独立订阅 wsClient.onMessage 触发。
        break;
      }

      default:
        // 未知消息类型忽略
        break;
    }
  }

  /** 确保当前 session 存在一条流式 assistant 消息，返回该消息 */
  function ensurePendingAssistant(sessionId: string): TaskMessage {
    let pending = pendingAssistant.get(sessionId);
    // 新一轮判定：上一轮最后一个 toolCall 已完成（status==='done'）→ 本轮 text/thinking 属于新一轮
    // 依据：同一轮内 text/thinking 必在 tool_call 之前；流式改造后 toolCalls 在 generating/executing
    // 阶段就已写入，只有 done 才标志上一轮 LLM 输出真正结束
    if (pending && pending.toolCalls && pending.toolCalls.length > 0) {
      const lastTc = pending.toolCalls[pending.toolCalls.length - 1];
      if (lastTc.status === 'done') {
        useStore.getState().updateMessage(sessionId, pending.id, { streaming: false, thinkingStreaming: false });
        pendingAssistant.delete(sessionId);
        pending = undefined;
      }
    }
    if (!pending) {
      pending = {
        id: genId(),
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        streaming: true,
        thinkingStreaming: false,
      };
      pendingAssistant.set(sessionId, pending);
      useStore.getState().addMessage(sessionId, pending);
    }
    return pending;
  }
}
