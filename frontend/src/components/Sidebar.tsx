// frontend/src/components/Sidebar.tsx
// 侧边栏：会话列表 + 面板切换

import { useEffect } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';

export function Sidebar() {
  const {
    sessions,
    activeSessionId,
    activePanel,
    setActiveSession,
    setSessions,
    setActivePanel,
    wsStatus,
  } = useStore();

  useEffect(() => {
    api.listSessions().then((r) => setSessions(r.sessions)).catch(() => {});
  }, [setSessions]);

  const handleNewSession = () => {
    setActiveSession(null);
    setActivePanel('chat');
  };

  return (
    <div className="app-sidebar">
      <div className="sidebar-section">
        <button className="primary" style={{ width: '100%' }} onClick={handleNewSession}>
          + 新对话
        </button>
      </div>

      <div className="sidebar-section" style={{ flex: 1 }}>
        <h3>会话</h3>
        {sessions.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '6px 10px' }}>
            (暂无会话)
          </div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              className={`sidebar-item ${activeSessionId === s.id && activePanel === 'chat' ? 'active' : ''}`}
              onClick={() => {
                setActiveSession(s.id);
                setActivePanel('chat');
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.id.slice(0, 20)}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="sidebar-section">
        <h3>设置</h3>
        <div
          className={`sidebar-item ${activePanel === 'config' ? 'active' : ''}`}
          onClick={() => setActivePanel('config')}
        >
          应用配置
        </div>
        <div
          className={`sidebar-item ${activePanel === 'api-config' ? 'active' : ''}`}
          onClick={() => setActivePanel('api-config')}
        >
          API 配置
        </div>
        <div
          className={`sidebar-item ${activePanel === 'mcp' ? 'active' : ''}`}
          onClick={() => setActivePanel('mcp')}
        >
          MCP 服务器
        </div>
      </div>

      <div className="sidebar-section">
        <div className="ws-status">
          <span className={`ws-status-dot ${wsStatus}`} />
          WS: {wsStatus}
        </div>
      </div>
    </div>
  );
}
