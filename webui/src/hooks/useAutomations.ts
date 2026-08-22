// UI/src/hooks/useAutomations.ts
// 自动化任务 hook：CRUD + trigger/pause/resume + history。
// 订阅 WS automation.started/finished 自动更新 history。

import { useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';
import { wsClient } from '../api/ws';
import type { AutomationDetail, AutomationRun } from '../types/api';
import { toast } from 'sonner';

export function useAutomations() {
  const setAutomations = useStore((s) => s.setAutomations);
  const setAutomationHistory = useStore((s) => s.setAutomationHistory);
  const addAutomationRun = useStore((s) => s.addAutomationRun);
  const updateAutomationRun = useStore((s) => s.updateAutomationRun);
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
    // 订阅 automation.started/finished
    const unsub = wsClient.onMessage((msg) => {
      if (msg.type === 'automation.started') {
        const p = (msg.payload ?? {}) as { automationId?: string; runId?: string; startedAt?: string };
        if (p.automationId && p.runId && p.startedAt) {
          const run: AutomationRun = {
            id: p.runId,
            automationId: p.automationId,
            startedAt: p.startedAt,
            status: 'running',
          };
          addAutomationRun(p.automationId, run);
        }
      } else if (msg.type === 'automation.finished') {
        const p = (msg.payload ?? {}) as {
          automationId?: string;
          runId?: string;
          status?: AutomationRun['status'];
          finishReason?: string;
          finalText?: string;
          error?: string;
          finishedAt?: string;
        };
        if (p.automationId && p.runId) {
          updateAutomationRun(p.automationId, p.runId, {
            finishedAt: p.finishedAt,
            status: p.status ?? 'success',
            finishReason: p.finishReason,
            finalText: p.finalText,
            error: p.error,
          });
          // 更新 automation 的 lastRunAt
          if (p.finishedAt) {
            updateAutomation(p.automationId, { lastRunAt: p.finishedAt });
          }
        }
      }
    });
    return unsub;
  }, [load, addAutomationRun, updateAutomationRun, updateAutomation]);

  const createAutomation = useCallback(
    async (data: {
      title: string;
      prompt: string;
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
