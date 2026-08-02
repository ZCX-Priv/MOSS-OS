// frontend/src/components/McpPanel.tsx
// MCP 服务器管理面板

import { useEffect, useState } from 'react';
import { api } from '../api/http';
import type { McpServer, McpTool } from '../types';

export function McpPanel() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([api.listMcpServers(), api.listMcpTools()]);
      setServers(s.servers);
      setTools(t.tools);
    } catch (err) {
      console.error('Failed to load MCP info:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleConnect = async (name: string) => {
    try {
      await api.connectMcpServer(name);
      await refresh();
    } catch (err) {
      alert(`连接失败: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleDisconnect = async (name: string) => {
    try {
      await api.disconnectMcpServer(name);
      await refresh();
    } catch (err) {
      alert(`断开失败: ${err instanceof Error ? err.message : err}`);
    }
  };

  // 按 server 分组工具
  const toolsByServer = tools.reduce<Record<string, McpTool[]>>((acc, t) => {
    (acc[t.server] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className="mcp-panel">
      <div className="config-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, border: 'none', padding: 0 }}>MCP 服务器</h2>
          <button onClick={refresh} disabled={loading}>
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>
      </div>

      {servers.length === 0 ? (
        <div className="config-section">
          <p style={{ color: 'var(--text-muted)' }}>
            暂无已连接的 MCP 服务器。请在 config.json 的 mcpServers 中配置。
          </p>
        </div>
      ) : (
        servers.map((s) => (
          <div key={s.name} className="mcp-server-card">
            <div className="mcp-server-header">
              <div>
                <span className={`mcp-status-dot ${s.status}`} />
                <strong>{s.name}</strong>
                <span style={{ marginLeft: '8px', color: 'var(--text-muted)' }}>
                  {s.toolCount} tools
                </span>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {s.status === 'connected' ? (
                  <button onClick={() => handleDisconnect(s.name)}>断开</button>
                ) : (
                  <button className="primary" onClick={() => handleConnect(s.name)}>
                    连接
                  </button>
                )}
              </div>
            </div>
            {toolsByServer[s.name] && toolsByServer[s.name].length > 0 && (
              <div style={{ marginTop: '8px', fontSize: '12px' }}>
                <div style={{ color: 'var(--text-muted)', marginBottom: '4px' }}>Tools:</div>
                {toolsByServer[s.name].map((t) => (
                  <div
                    key={t.name}
                    style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}
                  >
                    <code style={{ color: 'var(--warning)' }}>{t.name}</code>
                    {t.description && (
                      <span style={{ color: 'var(--text-secondary)', marginLeft: '8px' }}>
                        {t.description}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
