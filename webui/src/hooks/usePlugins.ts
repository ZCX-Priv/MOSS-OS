// UI/src/hooks/usePlugins.ts
// 插件管理 hook：挂载时拉取 plugins 写入 store；提供 update enabled。
// 阶段4.3：先尝试 /api/plugins（阶段6.1 后端就绪后），降级到 /api/extensions。
// 订阅 WS extension.changed 自动刷新。

import { useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';
import { wsClient } from '../api/ws';
import type { PluginItem } from '../types/api';
import { toast } from 'sonner';

export function usePlugins() {
  const setPlugins = useStore((s) => s.setPlugins);
  const updatePlugin = useStore((s) => s.updatePlugin);

  const load = useCallback(async () => {
    // 优先尝试 /api/plugins（阶段6.1 后端就绪后）
    try {
      const { plugins } = await api.listPlugins();
      setPlugins(plugins);
      return;
    } catch {
      // 降级到 /api/extensions（阶段3.1 已就绪）
    }
    try {
      const { modules, plugins: pluginList } = await api.listExtensions();
      // 合并 modules + plugins，统一映射为 PluginItem[]
      const all: PluginItem[] = [
        ...modules.map((m) => ({
          id: m.name,
          name: m.name,
          description: m.description ?? '',
          enabled: m.enabled,
          builtIn: true,
          type: 'module' as const,
          version: m.version,
        })),
        ...pluginList.map((p) => ({
          id: p.name,
          name: p.name,
          description: p.description ?? '',
          enabled: p.enabled,
          builtIn: true,
          type: 'plugin' as const,
          version: p.version,
        })),
      ];
      setPlugins(all);
    } catch (err) {
      console.warn('usePlugins load failed:', err);
    }
  }, [setPlugins]);

  useEffect(() => {
    void load();
    // 订阅 extension.changed 自动刷新
    const unsub = wsClient.onMessage((msg) => {
      if (msg.type === 'extension.changed') {
        void load();
      }
    });
    return unsub;
  }, [load]);

  const togglePlugin = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        // 优先 /api/plugins/:id，降级 /api/extensions/:name
        try {
          await api.updatePlugin(id, { enabled });
        } catch {
          await api.updateExtension(id, { enabled });
        }
        updatePlugin(id, { enabled });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [updatePlugin],
  );

  return {
    plugins: useStore((s) => s.plugins),
    reload: load,
    togglePlugin,
  };
}

/** 将内置插件映射为前端展示用渐变色（与 PluginMarketPage 旧硬编码对齐） */
export function getPluginIconGradient(name: string): string {
  const gradients: Record<string, string> = {
    agent: 'linear-gradient(135deg, #6366f1, #4f46d5)',
    llm: 'linear-gradient(135deg, #8b5cf6, #6B4BCC)',
    tools: 'linear-gradient(135deg, #06b6d4, #0891b2)',
    mcp: 'linear-gradient(135deg, #10b981, #059669)',
    server: 'linear-gradient(135deg, #f59e0b, #d97706)',
    daemon: 'linear-gradient(135deg, #ef4444, #dc2626)',
    update: 'linear-gradient(135deg, #ec4899, #be185d)',
    agents: 'linear-gradient(135deg, #4B8BFF, #2563eb)',
    automation: 'linear-gradient(135deg, #6B4BCC, #8b5cf6)',
  };
  return gradients[name] ?? 'linear-gradient(135deg, #64748b, #475569)';
}
