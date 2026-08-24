// UI/src/hooks/useFileIndex.ts
// 文件索引 hook：三引擎状态订阅（WS file-index.progress 实时推送 + 构建期间轮询兜底）。

import { useEffect, useCallback, useRef, useState } from 'react';
import { api } from '../api/http';
import { wsClient } from '../api/ws';
import type { FileIndexStatus } from '../types/api';

const POLL_INTERVAL_MS = 2000;

export function useFileIndex(cwd?: string) {
  const [status, setStatus] = useState<FileIndexStatus | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.getFileIndexStatus(cwd);
      setStatus(s);
      return s;
    } catch {
      return null;
    }
  }, [cwd]);

  useEffect(() => {
    void refresh();

    // WS 实时推送
    const unsub = wsClient.onMessage((msg) => {
      if (msg.type === 'file-index.progress' && msg.payload) {
        const payload = msg.payload as FileIndexStatus;
        if (!cwd || payload.projectRoot === cwd) {
          setStatus(payload);
        }
      }
    });

    // 构建期间轮询兜底（WS 未连接/丢失时进度仍可见）
    const isBuilding = (s: FileIndexStatus | null): boolean =>
      s !== null &&
      (s.indexing.state === 'scanning' ||
        (s.indexing.enabled && s.indexing.state === 'disabled') ||
        s.graph.state === 'scanning' ||
        (s.graph.enabled && s.graph.state === 'disabled') ||
        s.sag.state === 'scanning' ||
        (s.sag.enabled && s.sag.state === 'disabled'));

    pollTimer.current = setInterval(() => {
      if (isBuilding(status)) void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      unsub();
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, cwd]);

  const rebuild = useCallback(
    async (engines?: Array<'indexing' | 'graph' | 'sag'>) => {
      await api.rebuildFileIndex(cwd, engines);
      await refresh();
    },
    [cwd, refresh],
  );

  /** 任一引擎构建中（任务页进度条显隐） */
  const building =
    status !== null &&
    (status.indexing.state === 'scanning' ||
      status.graph.state === 'scanning' ||
      status.sag.state === 'scanning');

  /** 聚合进度（构建中最慢引擎的百分比；无构建返回 null） */
  const overallPercent = (() => {
    if (!building || !status) return null;
    const parts: number[] = [];
    if (status.indexing.state === 'scanning') parts.push(status.indexing.progress?.percent ?? 0);
    if (status.graph.state === 'scanning') parts.push(status.graph.progress?.percent ?? 0);
    if (status.sag.state === 'scanning') parts.push(status.sag.progress?.percent ?? 0);
    return parts.length > 0 ? Math.min(...parts) : null;
  })();

  return { status, refresh, rebuild, building, overallPercent };
}
