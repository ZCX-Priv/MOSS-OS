// UI/src/hooks/useContextFiles.ts
// 上下文文件 hook：按 sessionId 拉取；订阅 WS context-updated 自动刷新。

import { useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';
import { wsClient } from '../api/ws';
import type { ContextFile } from '../types/api';

export function useContextFiles(sessionId: string | null) {
  const setContext = useStore((s) => s.setContext);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const ctx = await api.getSessionContext(sessionId);
      setContext(sessionId, ctx);
    } catch (err) {
      console.warn('useContextFiles load failed:', err);
    }
  }, [sessionId, setContext]);

  useEffect(() => {
    void load();
    // 订阅 context-updated / file-created / file-edited（仅处理当前 session）
    const unsub = wsClient.onMessage((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.type === 'context-updated') {
        const p = (msg.payload ?? {}) as {
          files?: ContextFile[];
          totalTokens?: number;
          maxTokens?: number;
        };
        if (p.files) {
          setContext(sessionId, {
            files: p.files,
            totalTokens: p.totalTokens ?? 0,
            maxTokens: p.maxTokens ?? 0,
          });
        } else {
          void load();
        }
      } else if (msg.type === 'file-created' || msg.type === 'file-edited') {
        // 文件变更时重新拉取 context
        void load();
      }
    });
    return unsub;
  }, [load, sessionId, setContext]);

  return {
    context: useStore((s) =>
      sessionId
        ? s.contextBySession[sessionId] ?? { files: [], totalTokens: 0, maxTokens: 0 }
        : { files: [], totalTokens: 0, maxTokens: 0 },
    ),
    reload: load,
  };
}
