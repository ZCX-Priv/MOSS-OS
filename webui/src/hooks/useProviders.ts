// UI/src/hooks/useProviders.ts
// 服务商管理 hook：挂载时拉取 providers + current 写入 store；
// 提供服务商/模型两级 CRUD、远程模型列表拉取、余额查询、连通性测试。

import { useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';
import type {
  ProviderItem,
  ProviderModelItem,
  ProviderServiceItem,
  ThinkingLevelItem,
  RemoteModelItem,
  ProviderBalanceResult,
} from '../types/api';
import { toast } from 'sonner';

export type UseProvidersResult = ReturnType<typeof useProviders>;

export function useProviders() {
  const setProviders = useStore((s) => s.setProviders);
  const setCurrentModel = useStore((s) => s.setCurrentModel);

  const load = useCallback(async () => {
    try {
      const { providers, current } = await api.listProviders();
      setProviders(providers);
      if (current) setCurrentModel(current);
    } catch (err) {
      console.warn('useProviders load failed:', err);
    }
  }, [setProviders, setCurrentModel]);

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

  const createProvider = useCallback(
    async (data: {
      name: string;
      format: ProviderItem['format'];
      endpoint: string;
      apiKey: string;
      balanceUrl?: string;
      modelsUrl?: string;
    }) => {
      try {
        const provider = await api.createProvider(data);
        await load();
        return provider;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [load],
  );

  const updateProvider = useCallback(
    async (id: string, patch: Partial<Omit<ProviderItem, 'id' | 'models'>> & {
      thinkingLevels?: ThinkingLevelItem[];
    }) => {
      try {
        const provider = await api.updateProvider(id, patch);
        await load();
        return provider;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [load],
  );

  const addProviderService = useCallback(
    async (providerId: string, data: Omit<ProviderServiceItem, 'id'>) => {
      try {
        const service = await api.addProviderService(providerId, data);
        await load();
        return service;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [load],
  );

  const updateProviderService = useCallback(
    async (providerId: string, serviceId: string, patch: Partial<ProviderServiceItem>) => {
      try {
        const service = await api.updateProviderService(providerId, serviceId, patch);
        await load();
        return service;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [load],
  );

  const deleteProviderService = useCallback(
    async (providerId: string, serviceId: string) => {
      try {
        await api.deleteProviderService(providerId, serviceId);
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [load],
  );

  const deleteProvider = useCallback(
    async (id: string) => {
      try {
        await api.deleteProvider(id);
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [load],
  );

  const reorderProviders = useCallback(
    async (providerIds: string[]) => {
      try {
        await api.reorderProviders(providerIds);
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [load],
  );

  const addProviderModels = useCallback(
    async (
      providerId: string,
      models: Array<{
        name: string;
        model: string;
        thinking?: ProviderModelItem['thinking'];
        contextWindow?: string;
        inputTokens?: number;
        outputTokens?: number;
        temperature?: number;
        topP?: number;
        topK?: number;
      }>,
    ) => {
      try {
        const result = await api.addProviderModels(providerId, models);
        await load();
        return result;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [load],
  );

  const updateProviderModel = useCallback(
    async (providerId: string, modelId: string, patch: Partial<ProviderModelItem>) => {
      try {
        const model = await api.updateProviderModel(providerId, modelId, patch);
        await load();
        return model;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [load],
  );

  const deleteProviderModel = useCallback(
    async (providerId: string, modelId: string) => {
      try {
        await api.deleteProviderModel(providerId, modelId);
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [load],
  );

  const fetchProviderModels = useCallback(
    async (providerId: string): Promise<{ success: boolean; models: RemoteModelItem[]; error?: string }> => {
      try {
        return await api.fetchProviderModels(providerId);
      } catch (err) {
        return { success: false, models: [], error: err instanceof Error ? err.message : String(err) };
      }
    },
    [],
  );

  const fetchProviderBalance = useCallback(
    async (providerId: string): Promise<ProviderBalanceResult> => {
      try {
        return await api.fetchProviderBalance(providerId);
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [],
  );

  const testProviderModel = useCallback(
    async (
      providerId: string,
      modelId: string,
    ): Promise<{ success: boolean; latencyMs?: number; error?: string }> => {
      try {
        return await api.testProviderModel(providerId, modelId);
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [],
  );

  return {
    providers: useStore((s) => s.providers),
    currentModel: useStore((s) => s.currentModel),
    reload: load,
    setCurrent,
    createProvider,
    updateProvider,
    deleteProvider,
    reorderProviders,
    addProviderModels,
    updateProviderModel,
    deleteProviderModel,
    addProviderService,
    updateProviderService,
    deleteProviderService,
    fetchProviderModels,
    fetchProviderBalance,
    testProviderModel,
  };
}
