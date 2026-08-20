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
import { resolveWorkingDirectoryName } from '../lib/utils';
import i18n from '../i18n';
import type { AskOutcome, TaskMessage } from '../types/api';

function genId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function genRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 目录→分组：按名查找（大小写不敏感，兼容 Windows 目录）已有分组，无则自动创建。
 * 查服务端而非 store.taskGroups——避免列表未加载时误建重复组。
 * 失败返回 undefined（任务落默认分组，不阻断发消息）。
 */
async function ensureTaskGroup(name: string): Promise<string | undefined> {
  try {
    const { groups } = await api.listTaskGroups();
    const found = groups.find((g) => g.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    // 文件夹来源分组：空时由后端自动销毁
    const created = await api.createTaskGroup(name, 'folder');
    useStore.getState().addTaskGroup(created);
    return created.id;
  } catch {
    return undefined;
  }
}

/**
 * 解析消息开头的 skill 模式指令：
 *   /skill:<name> <正文> → { skill: name, message: 正文 }（正文空时用默认占位）
 *   /skill:exit          → { skill: null, message: 原文 }（退出模式；原文保留供 LLM 记录）
 *   其他                  → { skill: undefined, message: 原文 }
 */
function parseSkillPrefix(text: string): { skill: string | null | undefined; message: string } {
  const m = text.match(/^\/skill:([a-z0-9-]+)\s*([\s\S]*)$/i);
  if (!m) return { skill: undefined, message: text };
  const [, name, rest] = m;
  if (name.toLowerCase() === 'exit') {
    return { skill: null, message: text };
  }
  const body = rest.trim();
  return {
    skill: name,
    // 独占指令时给一句自然语言占位，LLM 立即按 skill 模式响应
    message: body || `（进入 ${name} 技能模式）`,
  };
}

export function useTask() {
  const addMessage = useStore((s) => s.addMessage);
  const setActiveSession = useStore((s) => s.setActiveSession);
  const setActiveTaskId = useStore((s) => s.setActiveTaskId);
  const setGenerating = useStore((s) => s.setGenerating);
  const finalizeStreamingMessages = useStore((s) => s.finalizeStreamingMessages);
  const addTask = useStore((s) => s.addTask);
  const touchTask = useStore((s) => s.touchTask);
  const removePendingAsk = useStore((s) => s.removePendingAsk);
  const removePendingConfirm = useStore((s) => s.removePendingConfirm);

  const sendMessage = useCallback(
    async (text: string, opts?: { taskId?: string; sessionId?: string }): Promise<string | undefined> => {
      if (!text.trim()) return undefined;
      // /skill:<name> 前缀解析（激活/切换/退出技能模式）
      const { skill, message: parsed } = parseSkillPrefix(text.trim());
      const content = parsed;

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
          // 目标分组按当前工作目录派生：文件夹名（D:\test → test）/ 本机模式 → "本机"组；不存在自动创建
          const groupName =
            resolveWorkingDirectoryName(state.workingDirectory) ?? i18n.t('directoryPicker.system');
          const groupId = await ensureTaskGroup(groupName);
          try {
            const task = await api.createTask(content.slice(0, 50), groupId);
            addTask(task);
            taskId = task.id;
            sessionId = task.sessionId ?? task.id;
          } catch {
            // 后端未就绪，本地生成 sessionId 降级
            sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          }
        }
      }

      // 活跃置顶：已有任务发送消息时乐观置顶（新建走 addTask 已置顶；后端 touchTask 持久化）
      if (taskId) touchTask(taskId);

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

      // 6. 通过 WS 发送流式任务请求（带 runId + agentId + skill 模式 + 权限模式）
      wsClient.send({
        type: 'task.stream',
        sessionId,
        payload: {
          message: content,
          model: state.currentModel || undefined,
          agentId: state.currentAgent || undefined,
          cwd: state.workingDirectory || undefined,
          runId,
          // skill 模式：undefined=不涉及；string=激活/切换；null=退出
          ...(skill !== undefined ? { skill } : {}),
          // 权限模式（会话级覆盖优先，缺省回退全局默认；后端 safety 统一决策）
          permissionMode: state.permissionModeBySession[sessionId] ?? state.permissionMode,
        },
      });

      return taskId;
    },
    [addMessage, setActiveSession, setActiveTaskId, setGenerating, finalizeStreamingMessages, addTask, touchTask],
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
    (toolCallId: string, outcome: AskOutcome) => {
      const ask = useStore.getState().pendingAsks.find((a) => a.toolCallId === toolCallId);
      if (!ask) return;
      wsClient.send({
        type: 'tool.ask.reply',
        sessionId: ask.sessionId,
        payload: { toolCallId, action: outcome.action, answer: outcome.answer },
      });
      removePendingAsk(toolCallId);
    },
    [removePendingAsk],
  );

  const replyConfirm = useCallback(
    (toolCallId: string, ok: boolean, remember?: 'session' | 'global') => {
      const cf = useStore.getState().pendingConfirms.find((c) => c.toolCallId === toolCallId);
      if (!cf) return;
      wsClient.send({
        type: 'tool.confirm.reply',
        sessionId: cf.sessionId,
        payload: { toolCallId, ok, remember },
      });
      removePendingConfirm(toolCallId);
    },
    [removePendingConfirm],
  );

  return { sendMessage, abort, replyAsk, replyConfirm };
}
