// frontend/src/api/http.ts
// HTTP 请求封装

import type { AppConfig, ApiConfig, McpServer, McpTool, Session, ChatMessage } from '../types';

const BASE_URL = '';

function getAuthToken(): string {
  return localStorage.getItem('moss-os-token') ?? '';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    const text = await resp.text();
    let msg = text;
    try {
      const json = JSON.parse(text);
      msg = json.error ?? text;
    } catch {
      // 非 JSON
    }
    throw new Error(`${resp.status}: ${msg}`);
  }

  return (await resp.json()) as T;
}

export const api = {
  // 健康
  health: () => request<{ status: string; uptime: number }>('GET', '/api/health'),

  // 配置
  getAppConfig: () => request<AppConfig>('GET', '/api/config'),
  updateAppConfig: (patch: Partial<AppConfig>) => request<AppConfig>('PUT', '/api/config', patch),
  getApiConfig: () => request<ApiConfig>('GET', '/api/api-config'),
  updateApiConfig: (patch: Partial<ApiConfig>) => request<ApiConfig>('PUT', '/api/api-config', patch),

  // 对话（非流式）
  chat: (message: string, sessionId?: string, model?: string, provider?: string, cwd?: string) =>
    request<{
      sessionId: string;
      finishReason: string;
      finalText: string;
      events: unknown[];
    }>('POST', '/api/chat', { message, sessionId, model, provider, cwd }),

  // 会话
  listSessions: () => request<{ sessions: Session[] }>('GET', '/api/session'),
  getSessionHistory: (id: string) => request<{ sessionId: string; messages: ChatMessage[] }>('GET', `/api/session/${id}`),
  deleteSession: (id: string) => request<{ deleted: boolean }>('DELETE', `/api/session/${id}`),

  // MCP
  listMcpServers: () => request<{ servers: McpServer[] }>('GET', '/api/mcp/servers'),
  listMcpTools: (server?: string) => request<{ tools: McpTool[] }>('GET', `/api/mcp/tools${server ? `?server=${server}` : ''}`),
  callMcpTool: (server: string, tool: string, args: unknown) =>
    request<unknown>('POST', '/api/mcp/call', { server, tool, arguments: args }),
  connectMcpServer: (server: string) => request<unknown>('POST', '/api/mcp/connect', { server }),
  disconnectMcpServer: (server: string) => request<unknown>('POST', '/api/mcp/disconnect', { server }),
};
