// UI/src/hooks/useAutomations.ts
// 自动化任务 hook：CRUD + trigger/pause/resume + history 拉取。
// WS automation.started/finished 事件由全局唯一的 useWebSocket 处理
// （曾在此订阅：每个 hook 实例都注册 handler，同一条消息被重复处理导致历史计数偏多）。

import { useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';
import type { AutomationDetail } from '../types/api';
import { toast } from 'sonner';

export function useAutomations() {
  const setAutomations = useStore((s) => s.setAutomations);
  const setAutomationHistory = useStore((s) => s.setAutomationHistory);
  const updateAutomation = useStore((s) => s.updateAutomation);

  const load = useCallback(async () => {
    try {
      const { automations } = await api.listAutomations();
      setAutomations(automations);
      // 同时拉取每个 automation 的历史（限前 20 个，避免过多请求）
      await Promise.all(
        automations.slice(0, 20).map(async (a) => {
          try {
            const { history } = await api.getAutomationHistory(a.id);
            setAutomationHistory(a.id, history);
          } catch {
            // 单个历史拉取失败不阻断
          }
        }),
      );
    } catch (err) {
      console.warn('useAutomations load failed:', err);
    }
  }, [setAutomations, setAutomationHistory]);

  useEffect(() => {
    void load();
  }, [load]);

  const createAutomation = useCallback(
    async (data: {
      title: string;
      prompt: string;
      cwd: string;
      description?: string;
      icon?: string;
      agentId?: string;
      scheduleType?: 'cron' | 'once';
      cron?: string;
      runAt?: string;
    }) => {
      try {
        const item = await api.createAutomation(data);
        await load();
        return item;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [load],
  );

  const updateAutomationFn = useCallback(
    async (id: string, patch: Partial<AutomationDetail>) => {
      try {
        const item = await api.updateAutomation(id, patch);
        await load();
        return item;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [load],
  );

  const deleteAutomation = useCallback(
    async (id: string) => {
      try {
        await api.deleteAutomation(id);
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [load],
  );

  const triggerAutomation = useCallback(async (id: string) => {
    try {
      return await api.triggerAutomation(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, []);

  const pauseAutomation = useCallback(async (id: string) => {
    try {
      await api.pauseAutomation(id);
      updateAutomation(id, { paused: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [updateAutomation]);

  const resumeAutomation = useCallback(async (id: string) => {
    try {
      await api.resumeAutomation(id);
      updateAutomation(id, { paused: false });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [updateAutomation]);

  return {
    automations: useStore((s) => s.automations),
    automationHistory: useStore((s) => s.automationHistory),
    reload: load,
    createAutomation,
    updateAutomation: updateAutomationFn,
    deleteAutomation,
    triggerAutomation,
    pauseAutomation,
    resumeAutomation,
  };
}
