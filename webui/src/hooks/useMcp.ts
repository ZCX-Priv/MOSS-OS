// UI/src/hooks/useMcp.ts
// MCP hook：拉取 MCP servers + tools，提供 connect/disconnect。

import { useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { api } from '../api/http';
import { toast } from 'sonner';

export function useMcp() {
  const setMcpServers = useStore((s) => s.setMcpServers);
  const setMcpTools = useStore((s) => s.setMcpTools);

  const load = useCallback(async () => {
    try {
      const [{ servers }, { tools }] = await Promise.all([
        api.listMcpServers(),
        api.listMcpTools(),
      ]);
      setMcpServers(servers);
      setMcpTools(tools);
    } catch (err) {
      console.warn('useMcp load failed:', err);
    }
  }, [setMcpServers, setMcpTools]);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = useCallback(
    async (server: string) => {
      try {
        await api.connectMcpServer(server);
        toast.success(`MCP 服务器已连接: ${server}`);
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [load],
  );

  const disconnect = useCallback(
    async (server: string) => {
      try {
        await api.disconnectMcpServer(server);
        toast.success(`MCP 服务器已断开: ${server}`);
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [load],
  );

  return {
    servers: useStore((s) => s.mcpServers),
    tools: useStore((s) => s.mcpTools),
    reload: load,
    connect,
    disconnect,
  };
}
