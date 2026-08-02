// frontend/src/components/ConfigPanel.tsx
// 应用配置面板

import { useConfig } from '../hooks/useConfig';
import type { AppConfig } from '../types';

export function ConfigPanel() {
  const { appConfig, updateAppConfig } = useConfig();

  if (!appConfig) {
    return <div className="config-panel">加载配置中...</div>;
  }

  const handleUpdate = (patch: Partial<AppConfig>) => {
    updateAppConfig(patch).catch((err) => alert(`更新失败: ${err.message}`));
  };

  return (
    <div className="config-panel">
      <div className="config-section">
        <h2>服务器</h2>
        <div className="config-row">
          <label>监听地址</label>
          <input
            value={appConfig.server.host}
            onChange={(e) => handleUpdate({ server: { ...appConfig.server, host: e.target.value } })}
          />
        </div>
        <div className="config-row">
          <label>端口</label>
          <input
            type="number"
            value={appConfig.server.port}
            onChange={(e) =>
              handleUpdate({ server: { ...appConfig.server, port: Number(e.target.value) } })
            }
          />
        </div>
        <div className="config-row">
          <label>自动选择端口</label>
          <input
            type="checkbox"
            checked={appConfig.server.autoPort}
            onChange={(e) =>
              handleUpdate({ server: { ...appConfig.server, autoPort: e.target.checked } })
            }
          />
        </div>
      </div>

      <div className="config-section">
        <h2>Agent</h2>
        <div className="config-row">
          <label>默认模型</label>
          <input
            value={appConfig.agent.defaultModel}
            onChange={(e) =>
              handleUpdate({ agent: { ...appConfig.agent, defaultModel: e.target.value } })
            }
          />
        </div>
        <div className="config-row">
          <label>最大 Tokens</label>
          <input
            type="number"
            value={appConfig.agent.maxTokens}
            onChange={(e) =>
              handleUpdate({ agent: { ...appConfig.agent, maxTokens: Number(e.target.value) } })
            }
          />
        </div>
        <div className="config-row">
          <label>最大轮次</label>
          <input
            type="number"
            value={appConfig.agent.maxTurns}
            onChange={(e) =>
              handleUpdate({ agent: { ...appConfig.agent, maxTurns: Number(e.target.value) } })
            }
          />
        </div>
        <div className="config-row">
          <label>工作目录</label>
          <input
            value={appConfig.agent.workingDirectory}
            placeholder="(留空使用进程 cwd)"
            onChange={(e) =>
              handleUpdate({ agent: { ...appConfig.agent, workingDirectory: e.target.value } })
            }
          />
        </div>
      </div>

      <div className="config-section">
        <h2>工具</h2>
        {(Object.keys(appConfig.tools) as Array<keyof AppConfig['tools']>).map((name) => {
          const tool = appConfig.tools[name];
          return (
            <div key={name} className="config-row">
              <label>{name}</label>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={tool.enabled}
                    onChange={(e) =>
                      handleUpdate({
                        tools: { ...appConfig.tools, [name]: { ...tool, enabled: e.target.checked } },
                      })
                    }
                  />
                  启用
                </label>
                {'requireConfirmation' in tool && (
                  <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={tool.requireConfirmation}
                      onChange={(e) =>
                        handleUpdate({
                          tools: {
                            ...appConfig.tools,
                            [name]: { ...tool, requireConfirmation: e.target.checked },
                          },
                        })
                      }
                    />
                    需确认
                  </label>
                )}
                {'timeout' in tool && (
                  <input
                    type="number"
                    value={tool.timeout}
                    style={{ width: '100px' }}
                    onChange={(e) =>
                      handleUpdate({
                        tools: { ...appConfig.tools, [name]: { ...tool, timeout: Number(e.target.value) } },
                      })
                    }
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="config-section">
        <h2>守护进程 & 更新</h2>
        <div className="config-row">
          <label>守护进程</label>
          <input
            type="checkbox"
            checked={appConfig.daemon.enabled}
            onChange={(e) =>
              handleUpdate({ daemon: { ...appConfig.daemon, enabled: e.target.checked } })
            }
          />
        </div>
        <div className="config-row">
          <label>日志级别</label>
          <select
            value={appConfig.daemon.logLevel}
            onChange={(e) =>
              handleUpdate({ daemon: { ...appConfig.daemon, logLevel: e.target.value } })
            }
          >
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
            <option value="fatal">fatal</option>
          </select>
        </div>
        <div className="config-row">
          <label>自动检查更新</label>
          <input
            type="checkbox"
            checked={appConfig.update.autoCheck}
            onChange={(e) =>
              handleUpdate({ update: { ...appConfig.update, autoCheck: e.target.checked } })
            }
          />
        </div>
      </div>

      <div className="config-section">
        <h2>安全</h2>
        <div className="config-row">
          <label>鉴权 Token</label>
          <input
            type="password"
            value={appConfig.security.authToken}
            placeholder="(留空则不鉴权)"
            onChange={(e) =>
              handleUpdate({ security: { ...appConfig.security, authToken: e.target.value } })
            }
          />
        </div>
        <div className="config-row">
          <label>仅绑定 localhost</label>
          <input
            type="checkbox"
            checked={appConfig.security.bindLocalhostOnly}
            onChange={(e) =>
              handleUpdate({
                security: { ...appConfig.security, bindLocalhostOnly: e.target.checked },
              })
            }
          />
        </div>
      </div>
    </div>
  );
}
