// frontend/src/components/ApiConfigPanel.tsx
// API 配置面板（含思考开关 + effort 调节）

import { useConfig } from '../hooks/useConfig';
import type { ApiConfig, ProviderConfig, ThinkingEffort } from '../types';

const EFFORTS: ThinkingEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

export function ApiConfigPanel() {
  const { apiConfig, updateApiConfig } = useConfig();

  if (!apiConfig) {
    return <div className="config-panel">加载配置中...</div>;
  }

  const handleUpdate = (patch: Partial<ApiConfig>) => {
    updateApiConfig(patch).catch((err) => alert(`更新失败: ${err.message}`));
  };

  const handleProviderUpdate = (name: string, providerPatch: Partial<ProviderConfig>) => {
    const newProviders = {
      ...apiConfig.providers,
      [name]: { ...apiConfig.providers[name], ...providerPatch },
    };
    handleUpdate({ providers: newProviders });
  };

  const handleThinkingUpdate = (
    name: string,
    thinkingPatch: Partial<ProviderConfig['thinking']>,
  ) => {
    const provider = apiConfig.providers[name];
    handleProviderUpdate(name, {
      thinking: { ...provider.thinking, ...thinkingPatch },
    });
  };

  return (
    <div className="config-panel">
      <div className="config-section">
        <h2>默认 Provider</h2>
        <div className="config-row">
          <label>defaultProvider</label>
          <select
            value={apiConfig.defaultProvider}
            onChange={(e) => handleUpdate({ defaultProvider: e.target.value })}
          >
            {Object.keys(apiConfig.providers).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="config-section">
        <h2>Providers ({Object.keys(apiConfig.providers).length})</h2>
        {Object.entries(apiConfig.providers).map(([name, p]) => (
          <div key={name} className="provider-card">
            <div className="provider-card-header">
              <h4>{name}</h4>
              <span className="provider-format-badge">{p.format}</span>
            </div>

            <div className="config-row">
              <label>Endpoint</label>
              <input
                value={p.endpoint}
                onChange={(e) => handleProviderUpdate(name, { endpoint: e.target.value })}
              />
            </div>
            <div className="config-row">
              <label>API Key</label>
              <input
                type="password"
                value={p.apiKey}
                placeholder="(输入 API Key)"
                onChange={(e) => handleProviderUpdate(name, { apiKey: e.target.value })}
              />
            </div>
            <div className="config-row">
              <label>Models</label>
              <input
                value={p.models.join(', ')}
                onChange={(e) =>
                  handleProviderUpdate(name, {
                    models: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
            </div>

            <div className="thinking-control">
              <label>
                <input
                  type="checkbox"
                  checked={p.thinking.enabled}
                  onChange={(e) => handleThinkingUpdate(name, { enabled: e.target.checked })}
                />
                思考模式
              </label>
              {p.thinking.enabled && (
                <>
                  <label>
                    Effort:
                    <select
                      value={p.thinking.effort ?? 'medium'}
                      onChange={(e) =>
                        handleThinkingUpdate(name, { effort: e.target.value as ThinkingEffort })
                      }
                    >
                      {EFFORTS.map((ef) => (
                        <option key={ef} value={ef}>
                          {ef}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(p.format === 'anthropic' || p.format === 'gemini') && (
                    <label>
                      Budget Tokens:
                      <input
                        type="number"
                        value={p.thinking.budgetTokens ?? 0}
                        onChange={(e) =>
                          handleThinkingUpdate(name, { budgetTokens: Number(e.target.value) })
                        }
                        style={{ width: '100px' }}
                      />
                    </label>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
