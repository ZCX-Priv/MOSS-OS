// webui/src/lib/pending-assistant.ts
// 跨 hook 共享的流式 assistant 消息管理器。
// useWebSocket 和 useTask 都需要访问 pending 状态，提取为模块级变量避免 useRef 跨 hook 不可达。

import type { TaskMessage } from '../types/api';

// 当前流式 assistant 消息（按 sessionId 索引）
const pendingMap: Record<string, TaskMessage> = {};
// 当前运行的 runId（按 sessionId 索引）
const runIdMap: Record<string, string> = {};

export const pendingAssistant = {
  get(sessionId: string): TaskMessage | undefined {
    return pendingMap[sessionId];
  },
  set(sessionId: string, msg: TaskMessage): void {
    pendingMap[sessionId] = msg;
  },
  delete(sessionId: string): void {
    delete pendingMap[sessionId];
  },
};

export const pendingRunId = {
  get(sessionId: string): string | undefined {
    return runIdMap[sessionId];
  },
  set(sessionId: string, runId: string): void {
    runIdMap[sessionId] = runId;
  },
  delete(sessionId: string): void {
    delete runIdMap[sessionId];
  },
};
