// webui/src/hooks/useRemote.ts
// 远程控制状态轮询 + 操作封装（设置页「远程控制」分区使用）。
// 轮询频率自适应：隧道建立期（非 idle/ready）1s，其余 3s；组件卸载自动清理。

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/http';
import type { RemotePasswords, RemoteStatus } from '../types/api';

export function useRemote() {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [passwords, setPasswords] = useState<RemotePasswords | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  const poll = useCallback(async (): Promise<void> => {
    try {
      const next = await api.getRemoteStatus();
      if (!aliveRef.current) return;
      setStatus(next);
      setLoadError(null);
      // 隧道建立期加速轮询
      const busy = next.tunnel.phase !== 'idle' && next.tunnel.phase !== 'ready';
      timerRef.current = setTimeout(poll, busy ? 1000 : 3000);
    } catch (err) {
      if (!aliveRef.current) return;
      setLoadError(err instanceof Error ? err.message : String(err));
      timerRef.current = setTimeout(poll, 3000);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void poll();
    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [poll]);

  /** 手动刷新（操作后立即拉取，不打断轮询节奏）。 */
  const refresh = useCallback(async (): Promise<void> => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await poll();
  }, [poll]);

  const refreshPasswords = useCallback(async (): Promise<void> => {
    try {
      const next = await api.getRemotePasswords();
      if (aliveRef.current) setPasswords(next);
    } catch {
      // 密码视图拉取失败不阻塞主流程
    }
  }, []);

  useEffect(() => {
    void refreshPasswords();
  }, [refreshPasswords]);

  /** 操作后统一刷新（状态 + 密码）。 */
  const refreshAll = useCallback(async (): Promise<void> => {
    await Promise.all([refresh(), refreshPasswords()]);
  }, [refresh, refreshPasswords]);

  return { status, passwords, loadError, refresh, refreshAll };
}
