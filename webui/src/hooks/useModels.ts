// UI/src/hooks/useModels.ts
// 模型管理 hook：挂载时拉取 models + current 写入 store；
// 提供 setCurrent/create/update/delete CRUD。

import { useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';
import type { ModelItem } from '../types/api';
import { toast } from 'sonner';

export function useModels() {
  const setModels = useStore((s) => s.setModels);
  const setCurrentModel = useStore((s) => s.setCurrentModel);

  const load = useCallback(async () => {
    try {
      const { models, current } = await api.listModels();
      setModels(models);
      if (current) setCurrentModel(current);
    } catch (err) {
      console.warn('useModels load failed:', err);
    }
  }, [setModels, setCurrentModel]);

  useEffect(() => {
    void load();
  }, [load]);

  const setCurrent = useCallback(
    async (modelId: string) => {
      try {
        await api.setCurrentModel(modelId);
        setCurrentModel(modelId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [setCurrentModel],
  );

  const createModel = useCallback(
    async (data: {
      name: string;
      model: string;
      format: ModelItem['format'];
      endpoint: string;
      apiKey: string;
      contextWindow?: string;
      thinking?: ModelItem['thinking'];
    }) => {
      try {
        const model = await api.createModel(data);
        await load();
        return model;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [load],
  );

  const updateModel = useCallback(
    async (id: string, patch: Partial<ModelItem>) => {
      try {
        const model = await api.updateModel(id, patch);
        await load();
        return model;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [load],
  );

  const deleteModel = useCallback(
    async (id: string) => {
      try {
        await api.deleteModel(id);
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [load],
  );

  const testModel = useCallback(
    async (id: string): Promise<{ success: boolean; latencyMs?: number; error?: string }> => {
      try {
        const result = await api.testModel(id);
        return result;
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [],
  );

  const reorderModels = useCallback(
    async (modelIds: string[]) => {
      try {
        await api.reorderModels(modelIds);
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [load],
  );

  return {
    models: useStore((s) => s.models),
    currentModel: useStore((s) => s.currentModel),
    reload: load,
    setCurrent,
    createModel,
    updateModel,
    deleteModel,
    testModel,
    reorderModels,
  };
}
