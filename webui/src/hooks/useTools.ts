// webui/src/hooks/useTools.ts
// 启动时拉取 /api/tools，缓存 toolName → icon 字符串到 store，供工具调用卡片渲染图标。

import { useEffect } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';

export function useTools() {
  const setToolIconMap = useStore((s) => s.setToolIconMap);

  useEffect(() => {
    void api
      .listTools()
      .then(({ tools }) => {
        const map: Record<string, string> = {};
        for (const t of tools) if (t.icon) map[t.name] = t.icon;
        setToolIconMap(map);
      })
      .catch((err) => console.warn('useTools load failed:', err));
  }, [setToolIconMap]);
}
