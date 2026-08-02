// frontend/src/App.tsx
// 应用根组件

import { useEffect } from 'react';
import { useStore } from './store';
import { wsClient } from './api/ws';
import { useConfig } from './hooks/useConfig';
import { Sidebar } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';
import { ConfigPanel } from './components/ConfigPanel';
import { ApiConfigPanel } from './components/ApiConfigPanel';
import { McpPanel } from './components/McpPanel';

export function App() {
  const { activePanel, setWsStatus } = useStore();
  useConfig();

  // 启动 WS 连接
  useEffect(() => {
    wsClient.connect();
    const unsub = wsClient.onStatus((status) => setWsStatus(status));
    return () => {
      unsub();
      wsClient.disconnect();
    };
  }, [setWsStatus]);

  return (
    <div className="app-layout">
      <div className="app-header">
        <strong>MOSS-OS</strong>
        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
          AI Agent · 微内核架构
        </span>
      </div>
      <Sidebar />
      <div className="app-main">
        {activePanel === 'chat' && <ChatPanel />}
        {activePanel === 'config' && <ConfigPanel />}
        {activePanel === 'api-config' && <ApiConfigPanel />}
        {activePanel === 'mcp' && <McpPanel />}
      </div>
    </div>
  );
}
