// UI/src/hooks/useTask.ts
// 任务 action hook：提供 sendMessage / abort / replyAsk。
// 事件流处理在 useWebSocket 中完成，本 hook 只负责发送动作。
//
// sendMessage 流程：
// 1. 确定 taskId：优先 opts.taskId > activeTaskId
// 2. 若 task 不存在（新任务），先 api.createTask 获取 task.id（= sessionId）
// 3. 若该 session 正在生成，立即中断旧流：task.abort + 清理 pending + finalizeStreamingMessages
// 4. 生成 runId（用于隔离不同 run 的事件）
// 5. 写入用户消息到 store
// 6. wsClient.send({type:'task.stream', sessionId, payload:{message,model,cwd,runId}})

import { useCallback } from 'react';
import { useStore } from '../store';
import { wsClient } from '../api/ws';
import { api } from '../api/http';
import { pendingAssistant, pendingRunId } from '../lib/pending-assistant';
import type { TaskMessage } from '../types/api';

function genId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function genRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useTask() {
  const addMessage = useStore((s) => s.addMessage);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const setActiveTaskId = useStore((s) => s.setActiveTaskId);
  const setGenerating = useStore((s) => s.setGenerating);
  const finalizeStreamingMessages = useStore((s) => s.finalizeStreamingMessages);
  const addTask = useStore((s) => s.addTask);
  const removePendingAsk = useStore((s) => s.removePendingAsk);

  const sendMessage = useCallback(
    async (text: string, opts?: { taskId?: string; sessionId?: string }): Promise<string | undefined> => {
      const content = text.trim();
      if (!content) return undefined;

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

      // 3. 若该 session 正在生成，立即中断旧流并清理前端状态
      //    不依赖后端异步 task.aborted 事件，避免旧流事件污染新流
      if (state.generatingBySession[sessionId]) {
        wsClient.send({ type: 'task.abort', sessionId });
        setGenerating(sessionId, false);
        pendingAssistant.delete(sessionId);
        finalizeStreamingMessages(sessionId);
      }

      // 4. 生成 runId（前端生成，后端原样注入事件，用于 run 级别隔离）
      const runId = genRunId();
      pendingRunId.set(sessionId, runId);

      setActiveSession(sessionId);
      if (taskId) setActiveTaskId(taskId);

      // 5. 写入用户消息
      const userMsg: TaskMessage = {
        id: genId(),
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      };
      addMessage(sessionId, userMsg);
      setGenerating(sessionId, true);

      // 6. 通过 WS 发送流式任务请求（带 runId）
      wsClient.send({
        type: 'task.stream',
        sessionId,
        payload: {
          message: content,
          model: state.currentModel || undefined,
          cwd: state.workingDirectory || undefined,
          runId,
        },
      });

      return taskId;
    },
    [addMessage, setActiveSession, setActiveTaskId, setGenerating, finalizeStreamingMessages, addTask],
  );

  const abort = useCallback((sessionIdOverride?: string) => {
    const sid = sessionIdOverride ?? useStore.getState().activeSessionId;
    if (!sid) return;
    wsClient.send({ type: 'task.abort', sessionId: sid });
    setGenerating(sid, false);
    // 立即清理前端状态，不等待后端 task.aborted 事件
    pendingAssistant.delete(sid);
    pendingRunId.delete(sid);
    finalizeStreamingMessages(sid);
  }, [setGenerating, finalizeStreamingMessages]);

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
