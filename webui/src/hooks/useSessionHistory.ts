// webui/src/hooks/useSessionHistory.ts
// 会话级编排：订阅 + 状态快照 + 分页加载 + 断线重连对齐 + 半截流式续接。
//
// 契约（根治「任务在后台跑、刷新后却显示已完成」）：
// - running（= 前端 generatingBySession）只由权威信号写入：
//     ① 状态快照 GET /api/session/:id/state
//     ② WS session.subscribed 快照（含后端 activeRuns 实况）
//     ③ 完成类事件（done / task.aborted / error / automation.finished）
//     ④ 本地发送与主动中断
//   **历史/快照的任何拉取都不得把 running 置 false**（除快照明确 running=false 且经尾部补齐收尾）。
// - 半截回复恢复：快照 liveDraft → 落成本地消息（id = 服务端 messageId）→ 后续分片按 offset 续接。

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/http';
import { wsClient } from '../api/ws';
import { useStore } from '../store';
import { pendingAssistant } from '../lib/pending-assistant';
import { flushPending, onStreamResyncNeeded, resetStreamBuffer } from '../lib/stream-buffer';
import {
  attachLiveDraft,
  fetchTailPages,
  onHistoryInvalidated,
  onSessionSnapshot,
  onStreamSettled,
} from '../lib/ws-events';
import type { SessionState, TaskMessage } from '../types/api';

/** 首屏与每页条数：30 条约占一屏多，JSON 体积可控（超长会话首屏不再传全量） */
export const HISTORY_PAGE_SIZE = 30;
/** Virtuoso firstItemIndex 起始值：向前 prepend 时递减，保证滚动位置不跳 */
const INITIAL_FIRST_ITEM_INDEX = 1_000_000;

export interface UseSessionHistoryResult {
  /** 加载更早的一页（Virtuoso startReached 回调） */
  loadOlder: () => void;
  /** Virtuoso firstItemIndex（prepend 时递减以保持视口锚定） */
  firstItemIndex: number;
  /** 是否还有更早的消息 */
  hasMoreBefore: boolean;
  /** 是否正在加载更早的一页 */
  loadingBefore: boolean;
  /** 首屏是否已加载完成（骨架屏判定） */
  loaded: boolean;
  /** 整体重载末页（撤回/恢复后游标失效、外部需要强制刷新时使用） */
  reload: () => Promise<void>;
}

export function useSessionHistory(taskId: string): UseSessionHistoryResult {
  const [firstItemIndex, setFirstItemIndex] = useState(INITIAL_FIRST_ITEM_INDEX);
  /** 已请求过首屏的会话（避免重复拉取；切换会话时重置） */
  const loadedRef = useRef<string | null>(null);
  /** 会话级「尾部补齐」串行化：同一时刻只允许一次，避免并发覆盖游标 */
  const catchupBusyRef = useRef(false);

  const hasMoreBefore = useStore((s) => s.historyMetaBySession[taskId]?.hasMoreBefore ?? false);
  const loadingBefore = useStore((s) => s.historyMetaBySession[taskId]?.loadingBefore ?? false);
  const metaLoaded = useStore((s) => s.historyMetaBySession[taskId]?.loaded ?? false);
  /**
   * 首屏是否已就绪。
   * 空白页（taskId === ''，即「新任务」页）**没有任何历史可加载**，语义上就是「已加载」——
   * 否则欢迎页会被"加载中"门控挡住，只剩一片骨架/空白。
   */
  const loaded = taskId === '' ? true : metaLoaded;

  /** 尾部增量补齐：把本地流式草稿替换为服务端正式消息（一轮结束 / 重连后） */
  const catchUpTail = useCallback(
    async (sessionId: string, dropStreaming: boolean) => {
      if (catchupBusyRef.current) return;
      catchupBusyRef.current = true;
      try {
        flushPending();
        const meta = useStore.getState().historyMetaBySession[sessionId];
        const after = meta?.newestIndex ?? -1;
        const res = await fetchTailPages(sessionId, after);
        if (!res) return;
        if (res.newestIndex <= after && res.messages.length === 0) return;
        useStore.getState().mergeHistory(
          sessionId,
          res.messages,
          'catchup',
          {
            total: res.total,
            oldestIndex: useStore.getState().historyMetaBySession[sessionId]?.oldestIndex ?? 0,
            newestIndex: Math.max(res.newestIndex, after),
            hasMoreBefore: useStore.getState().historyMetaBySession[sessionId]?.hasMoreBefore ?? false,
          },
          { dropStreaming },
        );
      } finally {
        catchupBusyRef.current = false;
      }
    },
    [],
  );

  /** 整体重载末页：撤回了消息 / 恢复后下标变化 → 旧游标不可用，必须重新取最新一页 */
  const reload = useCallback(async (): Promise<void> => {
    if (!taskId) return;
    flushPending();
    useStore.getState().resetHistory(taskId);
    try {
      const resp = await api.getSessionHistory(taskId, { limit: HISTORY_PAGE_SIZE });
      const st = useStore.getState();
      if (st.activeSessionId && st.activeSessionId !== taskId) return;
      st.mergeHistory(
        taskId,
        resp.messages,
        'tail',
        resp.page ?? {
          total: resp.messages.length,
          oldestIndex: 0,
          newestIndex: resp.messages.length - 1,
          hasMoreBefore: false,
        },
      );
    } catch {
      useStore.getState().patchHistoryMeta(taskId, { loaded: true });
    }
  }, [taskId]);

  /**
   * 与后端权威状态对齐：运行态 / 半截草稿 / 待答 / 待确认 / 权限模式 / 统计。
   * 用于：首屏、WS 重连、offset 缺口自愈三种时机。
   */
  const reconcileFromState = useCallback(async (sessionId: string): Promise<void> => {
    let state: SessionState;
    try {
      state = await api.getSessionState(sessionId);
    } catch {
      return;
    }
    const st = useStore.getState();
    // 会话已切换：丢弃过期结果（避免污染新会话）
    if (st.activeSessionId && st.activeSessionId !== sessionId) return;

    // ① 权威运行态（可升可降）：这是「刷新后仍显示运行中」的唯一依据
    st.setGenerating(sessionId, state.running);

    // ② 半截流式草稿（含 stale 的历史残留）
    if (state.liveDraft && state.liveDraft.messageId) {
      attachLiveDraft({ ...state.liveDraft, sessionId });
    }

    // ③ 待答提问 / 待确认权限：先清本会话再按服务端回填（幂等）
    st.clearPendingAsksBySession(sessionId);
    st.clearPendingConfirmsBySession(sessionId);
    for (const ask of state.pendingAsks) {
      st.addPendingAsk({
        toolCallId: ask.toolCallId,
        sessionId,
        question: ask.question,
        ...(ask.answerType ? { answerType: ask.answerType } : {}),
        ...(ask.options ? { options: ask.options } : {}),
        ...(ask.defaultAnswer ? { defaultAnswer: ask.defaultAnswer } : {}),
        ...(ask.formSchema ? { formSchema: ask.formSchema } : {}),
        createdAt: Date.now(),
      });
    }
    for (const cf of state.pendingConfirms) {
      st.addPendingConfirm({
        toolCallId: cf.toolCallId,
        sessionId,
        toolName: '',
        question: cf.question,
        ruleSuggestion: cf.ruleSuggestion,
        createdAt: Date.now(),
      });
    }

    // ④ 会话级权限模式 / 最近一次 run 统计
    if (state.permissionMode) st.setPermissionMode(state.permissionMode, sessionId);
    if (state.lastRunStats) st.setRunStats(sessionId, state.lastRunStats);

    // ⑤ 游标校正：断线期间后端可能新增了消息（本地 newestIndex 落后 → 补尾部）
    const meta = st.historyMetaBySession[sessionId];
    if (meta && state.newestIndex > meta.newestIndex) {
      await catchUpTail(sessionId, false);
    }
  }, [catchUpTail]);

  // ==========================================================================
  // 挂载 / 切换会话：订阅 + 首屏分页 + 并行加载附属数据
  // ==========================================================================
  // 注意：本 effect 内的异步续体**不使用 alive 守卫**——所有写入都是「会话键控的幂等
  // 写入」（mergeHistory 按消息 id 去重、setTodos/setContext/setContextStats 全量替换、
  // 压缩卡片按 compaction_<id> 去重），迟到/重复落库无害且正好命中缓存。
  // 此前用 alive 守卫 + loadedRef 防重发，在 React StrictMode（Vite dev 双调用 effect：
  // setup→cleanup→setup）下首屏请求被丢弃且第二次 setup 跳过重发 → 刷新后消息永远不加载。
  // 视图相关的守卫统一由 activeSessionId 判定（见 reconcileFromState）。
  useEffect(() => {
    if (!taskId) return;
    // 先订阅：后端 session.subscribed 会带回权威快照（running / liveDraft / 游标）
    wsClient.subscribeSession(taskId);

    const st0 = useStore.getState();
    st0.setActiveSession(taskId);
    st0.setActiveTaskId(taskId);

    const isFirstLoad = loadedRef.current !== taskId;
    if (isFirstLoad) {
      loadedRef.current = taskId;
      resetStreamBuffer(taskId);
      setFirstItemIndex(INITIAL_FIRST_ITEM_INDEX);
      st0.setWsRestoring(taskId, true);
      st0.patchHistoryMeta(taskId, { loaded: false, loadingBefore: false });
    }

    // ① 首屏历史（分页，仅末页）
    if (isFirstLoad) {
      void api
        .getSessionHistory(taskId, { limit: HISTORY_PAGE_SIZE })
        .then((resp) => {
          useStore.getState().mergeHistory(
            taskId,
            resp.messages,
            'tail',
            resp.page ?? {
              total: resp.messages.length,
              oldestIndex: 0,
              newestIndex: resp.messages.length - 1,
              hasMoreBefore: false,
            },
          );
          if (resp.permissionMode) useStore.getState().setPermissionMode(resp.permissionMode, taskId);
          if (resp.lastRunStats) useStore.getState().setRunStats(taskId, resp.lastRunStats);
        })
        .catch(() => {
          // 后端未就绪 / 会话不存在：静默（保持空态）
          useStore.getState().patchHistoryMeta(taskId, { loaded: true });
        });
    }

    // ② 权威状态快照（运行态 + 半截草稿 + 待答 / 待确认）
    void reconcileFromState(taskId)
      .catch(() => {})
      .finally(() => {
        useStore.getState().setWsRestoring(taskId, false);
      });

    // ③ 附属数据（todos / 上下文文件 / 上下文统计 / 压缩历史）：刷新后侧边面板恢复
    void api
      .listTodos(taskId)
      .then((resp) => {
        if (resp.todos) useStore.getState().setTodos(taskId, resp.todos);
      })
      .catch(() => {});
    void api
      .getSessionContext(taskId)
      .then((ctx) => {
        useStore.getState().setContext(taskId, {
          files: ctx.files,
          totalTokens: ctx.totalTokens,
          maxTokens: ctx.maxTokens,
        });
      })
      .catch(() => {});
    void api
      .getContextStats(taskId)
      .then((stats) => {
        useStore.getState().setContextStats(taskId, stats);
      })
      .catch(() => {});
    void api
      .getCompactions(taskId)
      .then(({ compactions }) => {
        if (!Array.isArray(compactions) || compactions.length === 0) return;
        const s = useStore.getState();
        const existing = s.messagesBySession[taskId] ?? [];
        const existingIds = new Set(existing.map((m) => m.id));
        const cards: TaskMessage[] = compactions
          .filter((c) => !existingIds.has(`compaction_${c.id}`))
          .map((c) => ({
            id: `compaction_${c.id}`,
            role: 'assistant' as const,
            content: c.summary,
            timestamp: c.at,
            compaction: c,
          }));
        if (cards.length > 0) {
          // 就地并入（按时间序）而非整体替换：分页窗口内的消息不被冲掉
          const merged = [...existing, ...cards].sort(
            (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
          );
          s.setMessages(taskId, merged);
        }
      })
      .catch(() => {});

    return () => {
      // 卸载时若 activeSessionId 仍指向自己则清除（防 useWebSocket 误用旧 session）。
      // 注意：不停止后端 agent.run（任务可在后台继续），也不清 pendingAssistant
      //（同一会话重新挂载时还要靠它继续接流）。
      const cur = useStore.getState().activeSessionId;
      if (cur === taskId) useStore.getState().setActiveSession(null);
    };
  }, [taskId, reconcileFromState]);

  // ==========================================================================
  // 编排信号：快照对齐 / 一轮结束补齐 / offset 缺口自愈
  // ==========================================================================
  useEffect(() => {
    if (!taskId) return;

    const unsubSnapshot = onSessionSnapshot((sessionId, payload) => {
      if (sessionId !== taskId) return;
      // 运行态：true 直接点亮（已在 ws-events 处理）；false 时若本地仍在生成 →
      // 说明断线期间任务已结束（事件丢失），做尾部补齐后收尾，杜绝 spinner 永转。
      if (payload.running === false) {
        const locallyGenerating = useStore.getState().generatingBySession[sessionId] ?? false;
        // 本地流式草稿换成服务端正式消息；若本地确实处于「生成中」，一并收尾
        // （断线期间任务已完成 → done 事件丢失 → 这里兜底，杜绝 spinner 永转）
        void catchUpTail(sessionId, locallyGenerating).then(() => {
          if (!locallyGenerating) return;
          const st = useStore.getState();
          st.finalizeStreamingMessages(sessionId);
          st.setGenerating(sessionId, false);
          pendingAssistant.delete(sessionId);
        });
      } else if (payload.running === true) {
        // 重连后仍在运行：对齐草稿（半截内容 / 工具卡片状态）
        void reconcileFromState(sessionId).catch(() => {});
      }
    });

    const unsubSettled = onStreamSettled((sessionId, reason) => {
      if (sessionId !== taskId) return;
      // 一轮结束：本地流式草稿换成服务端正式消息（含工具结果 / todo 快照）
      const drop = reason === 'done';
      void catchUpTail(sessionId, drop).then(() => {
        if (reason === 'done') pendingAssistant.delete(sessionId);
        resetStreamBuffer(sessionId);
      });
    });

    const unsubResync = onStreamResyncNeeded((sessionId) => {
      if (sessionId !== taskId) return;
      // 出现缺口（分片丢失 / 乱序）：用后端草稿重建该消息内容，精确愈合
      void reconcileFromState(sessionId).catch(() => {});
    });

    const unsubInvalidated = onHistoryInvalidated((sessionId) => {
      if (sessionId !== taskId) return;
      // 撤回 / 恢复：消息下标已变化 → 整体重载末页
      void reload();
    });

    return () => {
      unsubSnapshot();
      unsubSettled();
      unsubResync();
      unsubInvalidated();
    };
  }, [taskId, catchUpTail, reconcileFromState, reload]);

  // ==========================================================================
  // WS 重连：重新对齐（覆盖断线期间错过的消息 / 草稿推进 / 运行态变化）
  // ==========================================================================
  const wsStatus = useStore((s) => s.wsStatus);
  const prevStatusRef = useRef(wsStatus);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = wsStatus;
    if (!taskId) return;
    if (wsStatus === 'open' && prev !== 'open' && prev !== 'connecting') {
      // 断线后重连成功：重订阅 + 全量对齐
      wsClient.subscribeSession(taskId);
      void reconcileFromState(taskId).catch(() => {});
    }
  }, [wsStatus, taskId, reconcileFromState]);

  // ==========================================================================
  // 上滑加载更早的一页
  // ==========================================================================
  const loadOlder = useCallback(() => {
    if (!taskId) return;
    const st = useStore.getState();
    const meta = st.historyMetaBySession[taskId];
    if (!meta || !meta.hasMoreBefore || meta.loadingBefore) return;
    st.patchHistoryMeta(taskId, { loadingBefore: true });
    void api
      .getSessionHistory(taskId, { limit: HISTORY_PAGE_SIZE, before: meta.oldestIndex })
      .then((resp) => {
        const cur = useStore.getState();
        if (cur.activeSessionId && cur.activeSessionId !== taskId) return;
        if (!resp.page) {
          cur.patchHistoryMeta(taskId, { loadingBefore: false, hasMoreBefore: false });
          return;
        }
        const added = resp.messages.length;
        cur.mergeHistory(taskId, resp.messages, 'prepend', resp.page);
        // Virtuoso：prepend 时递减 firstItemIndex，视口锚定在原来的消息上（不跳动）
        if (added > 0) setFirstItemIndex((v) => v - added);
      })
      .catch(() => {
        useStore.getState().patchHistoryMeta(taskId, { loadingBefore: false });
      });
  }, [taskId]);

  return { loadOlder, firstItemIndex, hasMoreBefore, loadingBefore, loaded, reload };
}