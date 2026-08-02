// frontend/src/hooks/useConfig.ts
// 配置加载 hook

import { useEffect } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';
import type { AppConfig, ApiConfig } from '../types';

export function useConfig() {
  const {
    setAppConfig,
    setApiConfig,
    appConfig,
    apiConfig,
    setSelectedModel,
    setWorkingDirectory,
  } = useStore();

  useEffect(() => {
    Promise.all([api.getAppConfig(), api.getApiConfig()])
      .then(([app, apiCfg]) => {
        setAppConfig(app);
        setApiConfig(apiCfg);
        setSelectedModel(app.agent.defaultModel);
        setWorkingDirectory(app.agent.workingDirectory || '');
      })
      .catch((err) => {
        console.error('Failed to load config:', err);
      });
  }, [setAppConfig, setApiConfig, setSelectedModel, setWorkingDirectory]);

  const updateAppConfig = async (patch: Partial<AppConfig>) => {
    if (!appConfig) return;
    const updated = await api.updateAppConfig(patch);
    setAppConfig(updated);
  };

  const updateApiConfig = async (patch: Partial<ApiConfig>) => {
    if (!apiConfig) return;
    const updated = await api.updateApiConfig(patch);
    setApiConfig(updated);
  };

  return { appConfig, apiConfig, updateAppConfig, updateApiConfig };
}
