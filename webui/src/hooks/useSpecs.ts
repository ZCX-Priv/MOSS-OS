// UI/src/hooks/useSpecs.ts
// Specs 查询 hook：只读，挂载时拉取 specs 列表写入 store。

import { useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';
import { wsClient } from '../api/ws';

export function useSpecs() {
  const setSpecs = useStore((s) => s.setSpecs);

  const load = useCallback(async () => {
    try {
      const { specs } = await api.listSpecs();
      setSpecs(specs);
    } catch (err) {
      console.warn('useSpecs load failed:', err);
    }
  }, [setSpecs]);

  useEffect(() => {
    void load();
    // 订阅后端资源热重载，自动刷新
    const unsub = wsClient.onMessage((msg) => {
      if (msg.type === 'resources.changed') {
        void load();
      }
    });
    return unsub;
  }, [load]);

  return {
    specs: useStore((s) => s.specs),
    reload: load,
  };
}
