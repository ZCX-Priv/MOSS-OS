// UI/src/api/http.ts
// HTTP 请求封装：迁移自 webui/src/api/http.ts，扩展新接口函数。
// 所有函数返回类型引用 types/api.ts。

import type {
  AppConfig,
  ApiConfig,
  McpServer,
  McpTool,
  Session,
  ChatMessage,
  MessageRole,
  TaskItem,
  TaskGroup,
  ModelItem,
  AgentItem,
  AgentDetail,
  PluginItem,
  SkillItem,
  SkillDetail,
  SpecItem,
  SpecDetail,
  ToolItem,
  AutomationItem,
  AutomationDetail,
  AutomationRun,
  AutomationTemplate,
  ExtensionState,
  TodoItem,
  ContextFile,
  ResolveDirectoryResult,
  SuggestPath,
} from '../types/api';

const BASE_URL = '';

function getAuthToken(): string {
  return localStorage.getItem('moss-token') ?? '';
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

/**
 * 把后端 AgentMessage[] 适配为前端 ChatMessage[]：
 * - 过滤 system 消息（防御性，物理隔离后后端已不返回）
 * - 补 id / timestamp（后端 AgentMessage 无这两个字段）
 * - 把 role:'tool' 独立消息合并回前一条 assistant 的 toolResults
 */
function adaptAgentMessages(raw: unknown[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  const list = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i] as {
      role?: string;
      content?: string;
      toolCalls?: Array<{ id: string; name: string; arguments: string }>;
      toolCallId?: string;
      name?: string;
      thinking?: string;
    } | null;
    if (!m) continue;
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      // 合并到前一条 assistant 的 toolResults；孤立 tool 消息（前一条非 assistant）丢弃
      const prev = result[result.length - 1];
      if (prev && prev.role === 'assistant') {
        prev.toolResults = prev.toolResults ?? [];
        prev.toolResults.push({
          toolCallId: m.toolCallId ?? '',
          result: {
            content: [{ type: 'text', text: m.content ?? '' }],
          },
        });
      }
      continue;
    }
    // user / assistant
    result.push({
      id: `${i}-${m.role ?? 'msg'}`,
      role: m.role as MessageRole,
      content: m.content ?? '',
      thinking: m.thinking,
      toolCalls: m.toolCalls,
      timestamp: new Date().toISOString(),
    });
  }
  return result;
}

export const api = {
  // ==========================================================================
  // 健康
  // ==========================================================================
  health: () =>
    request<{
      status: string;
      timestamp: string;
      services: string[];
      uptime: number;
      modules: number;
      plugins: number;
      moduleStates: Record<string, string>;
      pluginStates: Record<string, string>;
    }>('GET', '/api/health'),

  // ==========================================================================
  // 配置
  // ==========================================================================
  getAppConfig: () => request<AppConfig>('GET', '/api/config'),
  updateAppConfig: (patch: Partial<AppConfig>) => request<AppConfig>('PUT', '/api/config', patch),
  getApiConfig: () => request<ApiConfig>('GET', '/api/api-config'),
  updateApiConfig: (patch: Partial<ApiConfig>) => request<ApiConfig>('PUT', '/api/api-config', patch),

  // ==========================================================================
  // 对话（非流式，fallback）
  // ==========================================================================
  chat: (message: string, sessionId?: string, model?: string, cwd?: string) =>
    request<{
      sessionId: string;
      finishReason: string;
      finalText: string;
      events: unknown[];
    }>('POST', '/api/chat', { message, sessionId, model, cwd }),

  // ==========================================================================
  // 会话
  // ==========================================================================
  listSessions: () => request<{ sessions: Session[] }>('GET', '/api/session'),
  getSessionHistory: async (id: string) => {
    const resp = await request<{ sessionId: string; messages: unknown[] }>('GET', `/api/session/${id}`);
    return { sessionId: resp.sessionId, messages: adaptAgentMessages(resp.messages) };
  },
  deleteSession: (id: string) => request<{ deleted: boolean }>('DELETE', `/api/session/${id}`),
  getSessionContext: (id: string) =>
    request<{ files: ContextFile[]; totalTokens: number; maxTokens: number }>(
      'GET',
      `/api/sessions/${id}/context`,
    ),

  // ==========================================================================
  // MCP
  // ==========================================================================
  listMcpServers: () => request<{ servers: McpServer[] }>('GET', '/api/mcp/servers'),
  listMcpTools: (server?: string) =>
    request<{ tools: McpTool[] }>('GET', `/api/mcp/tools${server ? `?server=${server}` : ''}`),
  callMcpTool: (server: string, tool: string, args: unknown) =>
    request<unknown>('POST', '/api/mcp/call', { server, tool, arguments: args }),
  connectMcpServer: (server: string) => request<unknown>('POST', '/api/mcp/connect', { server }),
  disconnectMcpServer: (server: string) => request<unknown>('POST', '/api/mcp/disconnect', { server }),

  // ==========================================================================
  // 工具（完整信息 + 启停）
  // ==========================================================================
  listTools: () => request<{ tools: ToolItem[] }>('GET', '/api/tools'),
  updateTool: (name: string, patch: { enabled?: boolean }) =>
    request<{ name: string; enabled: boolean }>('PATCH', `/api/tools/${encodeURIComponent(name)}`, patch),

  // ==========================================================================
  // 任务 + 分组（见文档 3.2.1）
  // ==========================================================================
  listTasks: () => request<{ groups: TaskGroup[]; tasks: TaskItem[] }>('GET', '/api/tasks'),
  createTask: (title: string, groupId?: string) =>
    request<TaskItem>('POST', '/api/tasks', { title, groupId }),
  getTask: async (id: string) => {
    const resp = await request<{ task: TaskItem; messages: unknown[]; todos: TodoItem[]; contextFiles: ContextFile[] }>(
      'GET',
      `/api/tasks/${id}`,
    );
    return { ...resp, messages: adaptAgentMessages(resp.messages) };
  },
  updateTask: (id: string, patch: Partial<Pick<TaskItem, 'title' | 'groupId'>>) =>
    request<TaskItem>('PATCH', `/api/tasks/${id}`, patch),
  deleteTask: (id: string) => request<{ deleted: boolean }>('DELETE', `/api/tasks/${id}`),

  listTaskGroups: () => request<{ groups: TaskGroup[] }>('GET', '/api/task-groups'),
  createTaskGroup: (name: string) => request<TaskGroup>('POST', '/api/task-groups', { name }),
  updateTaskGroup: (id: string, patch: { name?: string }) =>
    request<TaskGroup>('PATCH', `/api/task-groups/${id}`, patch),
  deleteTaskGroup: (id: string, moveTasksTo?: string) =>
    request<{ deleted: boolean }>('DELETE', `/api/task-groups/${id}`, { moveTasksTo }),

  // 搜索
  search: (q: string) =>
    request<{ tasks: TaskItem[]; messages?: Array<{ sessionId: string; messageId: string; text: string }> }>(
      'GET',
      `/api/search?q=${encodeURIComponent(q)}`,
    ),

  // ==========================================================================
  // 模型管理（见文档 3.2.2）
  // ==========================================================================
  listModels: () => request<{ models: ModelItem[]; current: string }>('GET', '/api/models'),
  setCurrentModel: (modelId: string) =>
    request<{ current: string }>('PUT', '/api/models/current', { modelId }),
  createModel: (data: {
    name: string;
    model: string;
    format: ModelItem['format'];
    endpoint: string;
    apiKey: string;
    contextWindow?: string;
    thinking?: ModelItem['thinking'];
  }) => request<ModelItem>('POST', '/api/models', data),
  updateModel: (id: string, patch: Partial<ModelItem>) =>
    request<ModelItem>('PATCH', `/api/models/${id}`, patch),
  deleteModel: (id: string) => request<{ deleted: boolean }>('DELETE', `/api/models/${id}`),
  testModel: (id: string) =>
    request<{ success: boolean; latencyMs?: number; error?: string; model?: string }>(
      'POST',
      `/api/models/${id}/test`,
    ),
  reorderModels: (modelIds: string[]) =>
    request<{ models: ModelItem[] }>('PUT', '/api/models/reorder', { modelIds }),

  // ==========================================================================
  // Agent 管理（见文档 3.2.3）
  // ==========================================================================
  listAgents: () => request<{ agents: AgentItem[]; default: string }>('GET', '/api/agents'),
  getAgent: (id: string) => request<AgentDetail>('GET', `/api/agents/${id}`),
  createAgent: (data: { name: string; systemPrompt?: string; model?: string; tools?: string[] }) =>
    request<AgentItem>('POST', '/api/agents', data),
  updateAgent: (id: string, patch: Partial<AgentDetail>) =>
    request<AgentItem>('PATCH', `/api/agents/${id}`, patch),
  deleteAgent: (id: string) => request<{ deleted: boolean }>('DELETE', `/api/agents/${id}`),
  setDefaultAgent: (id: string) =>
    request<{ default: string }>('PUT', '/api/agents/default', { id }),

  // ==========================================================================
  // 插件管理（见文档 3.2.4）
  // ==========================================================================
  listPlugins: () => request<{ plugins: PluginItem[] }>('GET', '/api/plugins'),
  getPlugin: (id: string) => request<PluginItem>('GET', `/api/plugins/${id}`),
  updatePlugin: (id: string, patch: { enabled?: boolean }) =>
    request<PluginItem>('PATCH', `/api/plugins/${id}`, patch),

  // ==========================================================================
  // Skills / Specs（见文档 3.2.5 / 3.2.6）
  // ==========================================================================
  listSkills: () => request<{ skills: SkillItem[] }>('GET', '/api/skills'),
  getSkill: (name: string) => request<{ skill: SkillDetail }>('GET', `/api/skills/${name}`),
  listSpecs: () => request<{ specs: SpecItem[] }>('GET', '/api/specs'),
  // detail 用 query 形式规避路径参数含斜杠问题
  getSpec: (id: string) =>
    request<{ spec: SpecDetail }>('GET', `/api/specs?id=${encodeURIComponent(id)}`),

  // ==========================================================================
  // 自动化任务（见文档 3.2.7）
  // ==========================================================================
  listAutomations: () => request<{ automations: AutomationItem[] }>('GET', '/api/automations'),
  getAutomation: (id: string) => request<AutomationDetail>('GET', `/api/automations/${id}`),
  createAutomation: (data: { title: string; cron: string; prompt: string; agentId?: string }) =>
    request<AutomationItem>('POST', '/api/automations', data),
  updateAutomation: (id: string, patch: Partial<AutomationDetail>) =>
    request<AutomationItem>('PATCH', `/api/automations/${id}`, patch),
  deleteAutomation: (id: string) =>
    request<{ deleted: boolean }>('DELETE', `/api/automations/${id}`),
  triggerAutomation: (id: string) =>
    request<{ runId: string }>('POST', `/api/automations/${id}/trigger`),
  pauseAutomation: (id: string) =>
    request<{ paused: boolean }>('POST', `/api/automations/${id}/pause`),
  resumeAutomation: (id: string) =>
    request<{ paused: boolean }>('POST', `/api/automations/${id}/resume`),
  getAutomationHistory: (id: string) =>
    request<{ history: AutomationRun[] }>('GET', `/api/automations/${id}/history`),
  listAutomationTemplates: () =>
    request<{ templates: AutomationTemplate[] }>('GET', '/api/automation-templates'),

  // ==========================================================================
  // 扩展状态（见文档 3.2.8）
  // ==========================================================================
  listExtensions: () =>
    request<{ modules: ExtensionState[]; plugins: ExtensionState[]; activeCount: number }>(
      'GET',
      '/api/extensions',
    ),
  updateExtension: (name: string, patch: { enabled?: boolean }) =>
    request<{ name: string; enabled: boolean }>('PATCH', `/api/extensions/${name}`, patch),

  // ==========================================================================
  // Todo（见文档 3.2.9）
  // ==========================================================================
  listTodos: (sessionId: string) =>
    request<{ todos: TodoItem[] }>('GET', `/api/todos/${sessionId}`),
  setTodos: (sessionId: string, todos: TodoItem[]) =>
    request<{ todos: TodoItem[] }>('PUT', `/api/todos/${sessionId}`, { todos }),

  // ==========================================================================
  // 版本（见文档 3.2.11）
  // ==========================================================================
  getVersion: () =>
    request<{ version: string; commit?: string; buildDate?: string; channel: string }>(
      'GET',
      '/api/version',
    ),

  // ==========================================================================
  // 文件系统（浏览器端文件夹选择：后端原生对话框拿真实绝对路径 + 搜索回退）
  // ==========================================================================
  pickDirectory: () =>
    request<{ path: string | null }>('POST', '/api/filesystem/pick-directory'),
  resolveDirectory: (folderName: string, hint?: string) =>
    request<ResolveDirectoryResult>('POST', '/api/filesystem/resolve-directory', {
      folderName,
      hint,
    }),
  suggestPaths: () => request<{ paths: SuggestPath[] }>('GET', '/api/filesystem/suggest-paths'),
};
