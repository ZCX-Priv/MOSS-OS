// UI/src/hooks/useSkills.ts
// Skills 查询 hook：只读，挂载时拉取 skills 列表写入 store。

import { useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';
import { wsClient } from '../api/ws';

export function useSkills() {
  const setSkills = useStore((s) => s.setSkills);

  const load = useCallback(async () => {
    try {
      const { skills } = await api.listSkills();
      setSkills(skills);
    } catch (err) {
      console.warn('useSkills load failed:', err);
    }
  }, [setSkills]);

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
    skills: useStore((s) => s.skills),
    reload: load,
  };
}
