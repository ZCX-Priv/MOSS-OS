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
//
// command/skill 一次性注入：TaskInput 在发送前已完成模板渲染（$ARGUMENTS 替换），
// 本 hook 收到的 text 即最终文本，直接透传。

import { useCallback } from 'react';
import { useStore } from '../store';
import { wsClient } from '../api/ws';
import { api } from '../api/http';
import { pendingAssistant, pendingRunId } from '../lib/pending-assistant';
import { resolveWorkingDirectoryName } from '../lib/utils';
import { stripAttachmentBlock } from '../lib/attachment-block';
import { stripInjectBlock } from '../lib/inject-block';
import { buildMentionLookups, stripMentionTokens } from '../components/shared/mention-data';
import { fileNameOf } from '../render/file/detector';
import i18n from '../i18n';
import type { AskOutcome, TaskMessage } from '../types/api';

function genId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function genRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 目录→分组名：按当前工作目录派生（文件夹名 / 本机模式 → "本机"组）。
 * 分组的查/建由后端 createTask(deriveGroupName) 一次完成（前端免 2 次串行往返）。
 */
function deriveGroupName(workingDirectory: string): string {
  return resolveWorkingDirectoryName(workingDirectory) ?? i18n.t('directoryPicker.system');
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
    async (text: string, opts?: { taskId?: string; sessionId?: string; attachments?: string[] }): Promise<string | undefined> => {
      if (!text.trim()) return undefined;
      // command/skill 的一次性注入渲染在 TaskInput 已完成，此处收到的即为最终文本
      const content = text.trim();
      // 附件绝对路径（纯路径引用）：随消息透传到后端结构化字段，供前端渲染附件卡片
      const attachments = opts?.attachments;

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
          // 新任务：先创建 task，获取 task.id 作为 sessionId。
          // 分组派生交给后端（deriveGroupName 一次往返内完成「查组/建组/归类」），
          // 此前前端串行 listTaskGroups+createTaskGroup+createTask 共 2-3 次往返，
          // 用户点击发送到看到「响应中」之间出现明显空白延迟。
          // 标题取「剥离附件块 + 命令注入块 + 内联 token 后的正文」（只发附件/只引文件时不显示路径）；
          // 用户正文为空（如只发 /命令）时回退：附件文件名 → 模板正文 → 可见文本（永不回退到含哨兵的原文）
          const lookups = buildMentionLookups(state.commands, state.skills, state.agents);
          const visible = stripInjectBlock(stripAttachmentBlock(content));
          const title =
            stripMentionTokens(visible, lookups) ||
            (attachments?.[0] ? fileNameOf(attachments[0]) : '') ||
            stripMentionTokens(stripInjectBlock(content), lookups) ||
            visible;
          try {
            const task = await api.createTask(
              title.slice(0, 50),
              undefined,
              deriveGroupName(state.workingDirectory),
            );
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

      // 3. 若该 session 正在生成，根据跟进行为决定处理方式
      if (state.generatingBySession[sessionId]) {
        const behavior = state.followUpBehavior;

        if (behavior === 'queue') {
          // 排队模式：消息加入队列，不中断当前任务
          const queuedMsg = {
            id: genId(),
            content,
            timestamp: new Date().toISOString(),
            ...(attachments ? { attachments } : {}),
          };
          useStore.getState().addToMessageQueue(sessionId, queuedMsg);
          return taskId;
        }

        // 引导模式：发送 task.guide，后端在工具调用完成后中止旧 run 并启动新 run
        const guideRunId = genRunId();
        pendingRunId.set(sessionId, guideRunId);
        finalizeStreamingMessages(sessionId);

        // clientMessageId：本地乐观消息与服务端持久化副本同身份（尾部补齐时按 id 去重）
        const guideClientMessageId = genId();
        const userMsg: TaskMessage = {
          id: guideClientMessageId,
          clientMessageId: guideClientMessageId,
          role: 'user',
          content,
          ...(attachments ? { attachments } : {}),
          timestamp: new Date().toISOString(),
        };
        addMessage(sessionId, userMsg);

        wsClient.send({
          type: 'task.guide',
          sessionId,
          payload: {
            message: content,
            runId: guideRunId,
            attachments,
            clientMessageId: guideClientMessageId,
          },
        });
        return taskId;
      }

      // 4. 生成 runId（前端生成，后端原样注入事件，用于 run 级别隔离）
      const runId = genRunId();
      pendingRunId.set(sessionId, runId);

      setActiveSession(sessionId);
      if (taskId) setActiveTaskId(taskId);

      // 5. 写入用户消息
      // clientMessageId：本地乐观消息与服务端持久化副本同身份，
      // 一轮结束后尾部补齐时按 id 天然去重（避免同一条消息渲染两份）
      const clientMessageId = genId();
      const userMsg: TaskMessage = {
        id: clientMessageId,
        clientMessageId,
        role: 'user',
        content,
        ...(attachments ? { attachments } : {}),
        timestamp: new Date().toISOString(),
      };
      addMessage(sessionId, userMsg);
      setGenerating(sessionId, true);

      // 6. 通过 WS 发送流式任务请求（带 runId + agentId + 权限模式）
      wsClient.send({
        type: 'task.stream',
        sessionId,
        payload: {
          message: content,
          // 前端消息 id（后端随用户消息持久化，前端据此与本地乐观副本对齐去重）
          clientMessageId,
          // 附件绝对路径（后端结构化字段持久化 + 前端渲染卡片）
          attachments,
          model: state.currentModel || undefined,
          agentId: state.currentAgent || undefined,
          cwd: state.workingDirectory || undefined,
          runId,
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
