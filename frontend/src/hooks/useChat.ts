// frontend/src/hooks/useChat.ts
// 对话 hook：通过 WS 流式对话

import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { wsClient } from '../api/ws';
import type { AgentEvent, ChatMessage, WSMessage } from '../types';

function genId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useChat() {
  const {
    activeSessionId,
    addMessage,
    appendToMessage,
    updateMessage,
    setIsGenerating,
    input,
    setInput,
    selectedModel,
    selectedProvider,
    workingDirectory,
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
  }, [activeSessionId, addMessage, appendToMessage, updateMessage, setIsGenerating]);

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

  return { sendMessage, abort };
}
