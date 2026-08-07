// UI/src/hooks/useChat.ts
// 对话 action hook：提供 sendMessage / abort / replyAsk。
// 事件流处理在 useWebSocket 中完成，本 hook 只负责发送动作。
//
// sendMessage 流程（阶段3.4 后修正）：
// 1. 确定 taskId：优先 opts.taskId > activeTaskId
// 2. 若 task 不存在（新任务），先 api.createTask 获取 task.id（= sessionId）
// 3. 写入用户消息到 store
// 4. wsClient.send({type:'chat.stream', sessionId, payload:{message,model,cwd}})

import { useCallback } from 'react';
import { useStore } from '../store';
import { wsClient } from '../api/ws';
import { api } from '../api/http';
import type { ChatMessage } from '../types/api';

function genId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useChat() {
  const addMessage = useStore((s) => s.addMessage);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const setActiveTaskId = useStore((s) => s.setActiveTaskId);
  const setGenerating = useStore((s) => s.setGenerating);
  const addTask = useStore((s) => s.addTask);
  const removePendingAsk = useStore((s) => s.removePendingAsk);

  const sendMessage = useCallback(
    async (text: string, opts?: { taskId?: string; sessionId?: string }) => {
      const content = text.trim();
      if (!content) return;

      const state = useStore.getState();

      // 1. 确定 taskId / sessionId
      let taskId = opts?.taskId !== undefined ? opts.taskId : (state.activeTaskId ?? '');
      let sessionId = opts?.sessionId ?? '';

      // 2. 若无 sessionId，尝试从已有 task 获取或创建新 task
      if (!sessionId) {
        if (taskId) {
          // 已有 task：task.id 即 sessionId（简化模型）
          const existingTask = state.tasks.find((t) => t.id === taskId);
          sessionId = existingTask?.sessionId ?? existingTask?.id ?? taskId;
        } else {
          // 新任务：先创建 task，获取 task.id 作为 sessionId
          try {
            const task = await api.createTask(content.slice(0, 50));
            addTask(task);
            taskId = task.id;
            sessionId = task.sessionId ?? task.id;
          } catch {
            // 后端未就绪，本地生成 sessionId 降级
            sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          }
        }
      }

      setActiveSession(sessionId);
      if (taskId) setActiveTaskId(taskId);

      // 3. 写入用户消息
      const userMsg: ChatMessage = {
        id: genId(),
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      };
      addMessage(sessionId, userMsg);
      setGenerating(sessionId, true);

      // 4. 通过 WS 发送流式对话请求
      wsClient.send({
        type: 'chat.stream',
        sessionId,
        payload: {
          message: content,
          model: state.currentModel || undefined,
          cwd: state.workingDirectory || undefined,
        },
      });
    },
    [addMessage, setActiveSession, setActiveTaskId, setGenerating, addTask],
  );

  const abort = useCallback(() => {
    const { activeSessionId } = useStore.getState();
    if (!activeSessionId) return;
    wsClient.send({ type: 'chat.abort', sessionId: activeSessionId });
    setGenerating(activeSessionId, false);
  }, [setGenerating]);

  const replyAsk = useCallback(
    (toolCallId: string, answer: string) => {
      const ask = useStore.getState().pendingAsks.find((a) => a.toolCallId === toolCallId);
      if (!ask) return;
      wsClient.send({
        type: 'tool.ask.reply',
        sessionId: ask.sessionId,
        payload: { toolCallId, answer },
      });
      removePendingAsk(toolCallId);
    },
    [removePendingAsk],
  );

  return { sendMessage, abort, replyAsk };
}
