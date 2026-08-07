// UI/src/hooks/useSkills.ts
// Skills 查询 hook：只读，挂载时拉取 skills 列表写入 store。

import { useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';

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
  }, [load]);

  return {
    skills: useStore((s) => s.skills),
    reload: load,
  };
}
