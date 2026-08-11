// webui/src/hooks/useTools.ts
// 工具管理 hook：挂载时拉取 /api/tools 完整列表写入 store，并派生 toolIconMap
// 供工具调用卡片渲染图标；提供 toggleTool 启停工具。
// 订阅 WS extension.changed 自动刷新（工具模组热重载时同步）。

import { useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';
import { wsClient } from '../api/ws';
import { toast } from 'sonner';

export function useTools() {
  const setTools = useStore((s) => s.setTools);
  const setToolIconMap = useStore((s) => s.setToolIconMap);
  const updateTool = useStore((s) => s.updateTool);

  const load = useCallback(async () => {
    try {
      const { tools } = await api.listTools();
      setTools(tools);
      // 派生 iconMap（兼容工具调用卡片图标渲染）
      const map: Record<string, string> = {};
      for (const t of tools) if (t.icon) map[t.name] = t.icon;
      setToolIconMap(map);
    } catch (err) {
      console.warn('useTools load failed:', err);
    }
  }, [setTools, setToolIconMap]);

  useEffect(() => {
    void load();
    // 订阅 extension.changed 自动刷新（工具模组属 extension 范畴）
    const unsub = wsClient.onMessage((msg) => {
      if (msg.type === 'extension.changed') {
        void load();
      }
    });
    return unsub;
  }, [load]);

  const toggleTool = useCallback(
    async (name: string, enabled: boolean) => {
      try {
        await api.updateTool(name, { enabled });
        updateTool(name, { enabled });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [updateTool],
  );

  return {
    tools: useStore((s) => s.tools),
    reload: load,
    toggleTool,
  };
}
