// UI/src/hooks/useSpecs.ts
// Specs 查询 hook：只读，挂载时拉取 specs 列表写入 store。

import { useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';

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
  }, [load]);

  return {
    specs: useStore((s) => s.specs),
    reload: load,
  };
}
