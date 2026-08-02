// frontend/src/hooks/useChat.ts
// 对话 hook：通过 WS 流式对话
//
// 本文件导出两个 hook：
// - useChatEvents：WS 事件处理单例，负责把后端事件流转成 store 状态更新。
//   只应在应用根组件（App.tsx）调用一次，重复调用会导致同一事件被多次处理。
// - useChat：对话 action 函数（sendMessage / abort / replyAsk），可在任意组件调用。

import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { wsClient } from '../api/ws';
import type { AgentEvent, ChatMessage, WSMessage } from '../types';

function genId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * WS 事件处理单例 hook：订阅 wsClient.onMessage，把后端事件流转换成 store 状态更新。
 * 只应在应用根组件调用一次（App.tsx），重复调用会导致同一事件被多次处理。
 */
export function useChatEvents() {
  const {
    activeSessionId,
    addMessage,
    appendToMessage,
    updateMessage,
    setIsGenerating,
    addPendingAsk,
  } = useStore();

  const pendingAssistantRef = useRef<Record<string, ChatMessage>>({});
  const pendingToolsRef = useRef<Record<string, { name: string; args: string; id: string }>>({});

  // 注册 WS 消息处理
  useEffect(() => {
    const unsub = wsClient.onMessage((msg: WSMessage) => {
      const sessionId = msg.sessionId ?? activeSessionId ?? '';
      if (!sessionId) return;

      const event = msg.payload as AgentEvent;

      switch (event.type) {
        case 'assistant-text': {
          // 找到当前流式的 assistant 消息
          let pending = pendingAssistantRef.current[sessionId];
          if (!pending) {
            pending = {
              id: genId(),
              role: 'assistant',
              content: '',
              timestamp: new Date().toISOString(),
              streaming: true,
            };
            pendingAssistantRef.current[sessionId] = pending;
            addMessage(sessionId, pending);
          }
          appendToMessage(sessionId, pending.id, 'content', event.text);
          break;
        }
        case 'assistant-thinking': {
          let pending = pendingAssistantRef.current[sessionId];
          if (!pending) {
            pending = {
              id: genId(),
              role: 'assistant',
              content: '',
              timestamp: new Date().toISOString(),
              streaming: true,
            };
            pendingAssistantRef.current[sessionId] = pending;
            addMessage(sessionId, pending);
          }
          appendToMessage(sessionId, pending.id, 'thinking', event.text);
          break;
        }
        case 'tool-call-start': {
          pendingToolsRef.current[event.toolCallId] = {
            name: event.toolName,
            args: typeof event.args === 'string' ? event.args : JSON.stringify(event.args ?? {}),
            id: event.toolCallId,
          };
          break;
        }
        case 'tool-call-end': {
          const toolInfo = pendingToolsRef.current[event.toolCallId];
          if (toolInfo) {
            delete pendingToolsRef.current[event.toolCallId];
          }
          // 把工具调用结果附加到当前 assistant 消息
          const pending = pendingAssistantRef.current[sessionId];
          if (pending) {
            updateMessage(sessionId, pending.id, {
              toolResults: [
                ...(pending.toolResults ?? []),
                { toolCallId: event.toolCallId, result: event.result },
              ],
              toolCalls: [
                ...(pending.toolCalls ?? []),
                { id: event.toolCallId, name: toolInfo?.name ?? event.toolName, arguments: toolInfo?.args ?? '' },
              ],
            });
          }
          break;
        }
        case 'ask': {
          // 工具向用户提问：加入 pending 列表，等待用户在 UI 上回复
          addPendingAsk({
            toolCallId: event.toolCallId,
            sessionId,
            question: event.question,
            createdAt: Date.now(),
          });
          break;
        }
        case 'error': {
          const errMsg: ChatMessage = {
            id: genId(),
            role: 'assistant',
            content: `Error: ${event.message}`,
            timestamp: new Date().toISOString(),
          };
          addMessage(sessionId, errMsg);
          setIsGenerating(false);
          delete pendingAssistantRef.current[sessionId];
          break;
        }
        case 'done': {
          const pending = pendingAssistantRef.current[sessionId];
          if (pending) {
            updateMessage(sessionId, pending.id, { streaming: false });
            delete pendingAssistantRef.current[sessionId];
          }
          setIsGenerating(false);
          // agent.run 结束，后端会兜底 reject 未完成的 ask；前端清空 UI 上的待答提问
          useStore.getState().clearPendingAsks();
          break;
        }
        default:
          // chat.done 等其他消息
          if (msg.type === 'chat.done') {
            const pending = pendingAssistantRef.current[sessionId];
            if (pending) {
              updateMessage(sessionId, pending.id, { streaming: false });
              delete pendingAssistantRef.current[sessionId];
            }
            setIsGenerating(false);
          }
      }
    });
    return unsub;
  }, [activeSessionId, addMessage, appendToMessage, updateMessage, setIsGenerating, addPendingAsk]);
}

/**
 * 对话 action hook：提供 sendMessage / abort / replyAsk 三个动作函数。
 * 可在任意组件调用，不会产生 WS 事件重复订阅。
 */
export function useChat() {
  const {
    activeSessionId,
    addMessage,
    setInput,
    setIsGenerating,
    selectedModel,
    selectedProvider,
    workingDirectory,
    removePendingAsk,
    input,
  } = useStore();

  const sendMessage = useCallback(
    (text?: string) => {
      const content = text ?? input;
      if (!content.trim() || useStore.getState().isGenerating) return;

      const sessionId = activeSessionId ?? `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (!activeSessionId) {
        useStore.getState().setActiveSession(sessionId);
      }

      // 添加用户消息
      const userMsg: ChatMessage = {
        id: genId(),
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      };
      addMessage(sessionId, userMsg);
      setInput('');
      setIsGenerating(true);

      // 通过 WS 发送流式对话请求
      wsClient.send({
        type: 'chat.stream',
        sessionId,
        payload: {
          message: content,
          model: selectedModel || undefined,
          provider: selectedProvider || undefined,
          cwd: workingDirectory || undefined,
        },
      });
    },
    [input, activeSessionId, addMessage, setInput, setIsGenerating, selectedModel, selectedProvider, workingDirectory],
  );

  const abort = useCallback(() => {
    if (!activeSessionId) return;
    wsClient.send({ type: 'chat.abort', sessionId: activeSessionId });
    setIsGenerating(false);
  }, [activeSessionId, setIsGenerating]);

  /** 回复工具发起的提问 */
  const replyAsk = useCallback((toolCallId: string, answer: string) => {
    const ask = useStore.getState().pendingAsks.find((a) => a.toolCallId === toolCallId);
    if (!ask) return;
    wsClient.send({
      type: 'tool.ask.reply',
      sessionId: ask.sessionId,
      payload: { toolCallId, answer },
    });
    // 乐观移除：后端收到后会 resolve Promise，工具继续执行
    removePendingAsk(toolCallId);
  }, [removePendingAsk]);

  return { sendMessage, abort, replyAsk };
}
