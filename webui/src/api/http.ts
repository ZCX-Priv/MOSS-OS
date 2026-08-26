// UI/src/api/http.ts
// HTTP 请求封装：迁移自 webui/src/api/http.ts，扩展新接口函数。
// 所有函数返回类型引用 types/api.ts。

import type {
  AppConfig,
  ApiConfig,
  McpServer,
  McpTool,
  Session,
  TaskMessage,
  MessageRole,
  TaskItem,
  TaskGroup,
  ProviderItem,
  ProviderModelItem,
  ProviderServiceItem,
  ThinkingLevelItem,
  RemoteModelItem,
  ProviderBalanceResult,
  AgentItem,
  AgentDetail,
  SkillItem,
  SkillDetail,
  CommandItem,
  CommandUpsertBody,
  SpecItem,
  SpecDetail,
  ToolItem,
  AutomationItem,
  AutomationDetail,
  AutomationRun,
  TodoItem,
  ContextFile,
  ResolveDirectoryResult,
  SuggestPath,
  SearchedFile,
  PickedFile,
  RunStats,
  LogFileInfo,
  LogQueryResult,
  LogLevel,
  ContextStats,
  CompactionRecord,
  CompactPreview,
  ManualCompactResult,
  FileIndexStatus,
  RulesListResult,
  RuleItem,
  RuleUpsertBody,
  HooksListResult,
  HookItem,
  HookUpsertBody,
  HookTestResult,
  HookHistoryEntry,
  MemoryItem,
  MemoryPalaceTree,
  MemoryUpsertBody,
  MemoryDistillResult,
} from '../types/api';
import i18n from '../i18n';

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
      const errorCode = json.error ?? text;
      // 尝试通过 i18n 翻译错误码
      msg = i18n.exists(`errors.${errorCode}`) ? i18n.t(`errors.${errorCode}`) : errorCode;
    } catch {
      // 非 JSON
    }
    throw new Error(`${resp.status}: ${msg}`);
  }

  return (await resp.json()) as T;
}

/**
 * 把后端 AgentMessage[] 适配为前端 TaskMessage[]：
 * - 过滤 system 消息（防御性，物理隔离后后端已不返回）
 * - 补 id / timestamp（后端 AgentMessage 无这两个字段）
 * - 把 role:'tool' 独立消息合并回前一条 assistant 的 toolResults
 */
function adaptAgentMessages(raw: unknown[]): TaskMessage[] {
  const result: TaskMessage[] = [];
  const list = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i] as {
      role?: string;
      content?: string;
      toolCalls?: Array<{ id: string; name: string; arguments: string }>;
      toolCallId?: string;
      name?: string;
      thinking?: string;
      todoSnapshot?: TaskMessage['todoSnapshot'];
      isError?: boolean;
      metadata?: Record<string, unknown>;
      timestamp?: string;
    } | null;
    if (!m) continue;
    if (m.role === 'system') continue;
    // 压缩摘要消息（compaction-summary）与 day-rollover/env-context 不进消息流：
    // 压缩卡片由 getCompactions 历史恢复（TaskPage 合并），其余为引擎内部锚定消息
    // （active-rules = paths 规则注入锚定 / memory-l1 = 记忆关键事实锚定）
    if (
      m.name === 'compaction-summary' ||
      m.name === 'env-context' ||
      m.name === 'day-rollover' ||
      m.name === 'active-rules' ||
      m.name === 'memory-l1'
    ) {
      continue;
    }
    // 轮数触顶提示消息：转为提示卡（maxTurnsNotice 驱动卡片渲染 + 继续按钮）
    if (m.name === 'max-turns-notice') {
      const noticeMeta = m.metadata as { maxTurns?: number } | undefined;
      result.push({
        id: `${i}-max-turns-notice`,
        role: 'assistant',
        content: m.content ?? '',
        maxTurnsNotice: { maxTurns: typeof noticeMeta?.maxTurns === 'number' ? noticeMeta.maxTurns : 0 },
        timestamp: m.timestamp ?? new Date().toISOString(),
      });
      continue;
    }
    if (m.role === 'tool') {
      // 合并到前一条 assistant 的 toolResults；孤立 tool 消息（前一条非 assistant）丢弃
      const prev = result[result.length - 1];
      if (prev && prev.role === 'assistant') {
        prev.toolResults = prev.toolResults ?? [];
        prev.toolResults.push({
          toolCallId: m.toolCallId ?? '',
          result: {
            content: [{ type: 'text', text: m.content ?? '' }],
            ...(m.isError ? { isError: true } : {}),
            ...(m.metadata ? { metadata: m.metadata } : {}),
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
      todoSnapshot: m.todoSnapshot,
      // 历史恢复保留错误标记（否则刷新后错误消息变成普通正文渲染）
      ...(m.isError ? { isError: true } : {}),
      timestamp: m.timestamp ?? new Date().toISOString(),
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
  // 会话
  // ==========================================================================
  listSessions: () => request<{ sessions: Session[] }>('GET', '/api/session'),
  getSessionHistory: async (id: string) => {
    const resp = await request<{
      sessionId: string;
      messages: unknown[];
      permissionMode?: 'ask' | 'auto' | 'skip';
      lastRunStats?: RunStats;
    }>('GET', `/api/session/${id}`);
    return {
      sessionId: resp.sessionId,
      messages: adaptAgentMessages(resp.messages),
      ...(resp.permissionMode ? { permissionMode: resp.permissionMode } : {}),
      ...(resp.lastRunStats ? { lastRunStats: resp.lastRunStats } : {}),
    };
  },
  deleteSession: (id: string) => request<{ deleted: boolean }>('DELETE', `/api/session/${id}`),
  getSessionContext: (id: string) =>
    request<{ files: ContextFile[]; totalTokens: number; maxTokens: number }>(
      'GET',
      `/api/sessions/${id}/context`,
    ),
  /** preview truncate: messages to remove + file changes to roll back */
  previewTruncate: (id: string, messageTimestamp: string, content: string) =>
    request<{
      sessionId: string;
      messagesToRemove: Array<{ index: number; role: string; content: string; timestamp?: string }>;
      fileChanges: Array<{ absPath: string; operation: string; toolName: string; timestamp: string }>;
      rollbackSkippedReason?: 'no-file-history' | 'no-timestamp';
    }>(
      'GET',
      `/api/sessions/${encodeURIComponent(id)}/truncate-preview?messageTimestamp=${encodeURIComponent(messageTimestamp)}&content=${encodeURIComponent(content)}`,
    ),
  /** execute truncate (soft delete messages + rollback file changes) */
  truncateSession: (id: string, messageTimestamp: string, content: string) =>
    request<{
      sessionId: string;
      removedCount: number;
      rolledBackFiles: number;
      rollbackFailed: Array<{ absPath: string; error: string }>;
      truncatedBeforeTimestamp: string;
      fileRollbackPerformed: boolean;
      rollbackSkippedReason?: 'no-file-history' | 'no-timestamp';
    }>(
      'POST',
      `/api/sessions/${encodeURIComponent(id)}/truncate`,
      { messageTimestamp, content },
    ),
  /** restore last truncate (redo) */
  restoreTruncate: (id: string) =>
    request<{ sessionId: string; restoredCount: number; restoredFiles: number; restoreFailed: Array<{ absPath: string; error: string }> }>(
      'POST',
      `/api/sessions/${encodeURIComponent(id)}/truncate-restore`,
    ),

  // ==========================================================================
  // 上下文引擎（token 构成 / 缓存命中 / 压缩历史 / 手动压缩 / 摘要模型）
  // ==========================================================================
  getContextStats: (id: string) =>
    request<ContextStats>('GET', `/api/context/${encodeURIComponent(id)}/stats`),
  getCompactions: (id: string) =>
    request<{ compactions: CompactionRecord[] }>(
      'GET',
      `/api/context/${encodeURIComponent(id)}/compactions`,
    ),
  compactPreview: (id: string) =>
    request<CompactPreview>('GET', `/api/context/${encodeURIComponent(id)}/compact-preview`),
  manualCompact: (id: string, focus?: string) =>
    request<ManualCompactResult>(
      'POST',
      `/api/context/${encodeURIComponent(id)}/compact`,
      focus ? { focus } : {},
    ),
  getSummaryModels: () =>
    request<{ models: Array<{ id: string; name: string; model: string }> }>(
      'GET',
      '/api/context/summary-models',
    ),

  // ==========================================================================
  // 文件索引（三引擎状态 / 手动重建）
  // ==========================================================================
  getFileIndexStatus: (cwd?: string) =>
    request<FileIndexStatus>(
      'GET',
      `/api/context/file-index/status${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`,
    ),
  rebuildFileIndex: (cwd?: string, engines?: Array<'indexing' | 'graph' | 'sag'>) =>
    request<{ ok: boolean }>(
      'POST',
      '/api/context/file-index/rebuild',
      { ...(cwd ? { cwd } : {}), ...(engines ? { engines } : {}) },
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
  /** Xinjian server definition (body: { name, ...ServerConfig }) */
  createMcpServer: (def: Omit<McpServer, 'status' | 'toolCount'> & { name: string }) =>
    request<{ created: boolean; server: string }>('POST', '/api/mcp/servers', def),
  /** Gengxin server definition (incl. enabled toggle; body: ServerConfig) */
  updateMcpServer: (name: string, def: Partial<Omit<McpServer, 'name' | 'status' | 'toolCount'>>) =>
    request<{ updated: boolean; server: string }>('PUT', `/api/mcp/servers/${encodeURIComponent(name)}`, def),
  /** Shanchu server definition */
  deleteMcpServer: (name: string) =>
    request<{ deleted: boolean; server: string }>('DELETE', `/api/mcp/servers/${encodeURIComponent(name)}`),

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
  reorderTasks: (taskIds: string[]) =>
    request<{ reordered: boolean; tasks: TaskItem[] }>('PUT', '/api/tasks/reorder', { taskIds }),

  listTaskGroups: () => request<{ groups: TaskGroup[] }>('GET', '/api/task-groups'),
  createTaskGroup: (name: string, source?: 'folder' | 'manual') =>
    request<TaskGroup>('POST', '/api/task-groups', { name, source }),
  updateTaskGroup: (id: string, patch: { name?: string }) =>
    request<TaskGroup>('PATCH', `/api/task-groups/${id}`, patch),
  deleteTaskGroup: (id: string, moveTasksTo?: string, deleteTasks?: boolean) =>
    request<{ deleted: boolean }>('DELETE', `/api/task-groups/${id}`, { moveTasksTo, deleteTasks }),

  // 搜索
  search: (q: string) =>
    request<{ tasks: TaskItem[]; messages?: Array<{ sessionId: string; messageId: string; text: string }> }>(
      'GET',
      `/api/search?q=${encodeURIComponent(q)}`,
    ),

  // ==========================================================================
  // 服务商管理（服务商持有 API 格式/地址/Key，模型挂其下）
  // ==========================================================================
  listProviders: () =>
    request<{ providers: ProviderItem[]; current: string }>('GET', '/api/providers'),
  setCurrentModel: (modelId: string) =>
    request<{ current: string }>('PUT', '/api/providers/current', { modelId }),
  createProvider: (data: {
    name: string;
    format: ProviderItem['format'];
    endpoint: string;
    apiKey: string;
    balanceUrl?: string;
    modelsUrl?: string;
    icon?: string;
  }) => request<ProviderItem>('POST', '/api/providers', data),
  updateProvider: (id: string, patch: Partial<Omit<ProviderItem, 'id' | 'models'>>) =>
    request<ProviderItem>('PATCH', `/api/providers/${id}`, patch),
  deleteProvider: (id: string) =>
    request<{ deleted: boolean }>('DELETE', `/api/providers/${id}`),
  reorderProviders: (providerIds: string[]) =>
    request<{ providers: ProviderItem[] }>('PUT', '/api/providers/reorder', { providerIds }),
  /** 批量/单个添加模型（body 兼容 {models:[...]} 与单对象） */
  addProviderModels: (
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
      thinkingLevels?: ThinkingLevelItem[];
    }>,
  ) =>
    request<{ provider: ProviderItem; added: number }>(
      'POST',
      `/api/providers/${providerId}/models`,
      { models },
    ),
  updateProviderModel: (providerId: string, modelId: string, patch: Partial<ProviderModelItem>) =>
    request<ProviderModelItem>('PATCH', `/api/providers/${providerId}/models/${modelId}`, patch),
  deleteProviderModel: (providerId: string, modelId: string) =>
    request<{ deleted: boolean }>('DELETE', `/api/providers/${providerId}/models/${modelId}`),
  /** 服务端代理拉取远程模型列表（归一化 {id, name?}[]） */
  fetchProviderModels: (providerId: string) =>
    request<{ success: boolean; models: RemoteModelItem[]; url?: string; error?: string }>(
      'POST',
      `/api/providers/${providerId}/models/fetch`,
    ),
  /** 服务端代理查询余额（OpenAI 兼容计费格式） */
  fetchProviderBalance: (providerId: string) =>
    request<ProviderBalanceResult>('POST', `/api/providers/${providerId}/balance`),
  testProviderModel: (providerId: string, modelId: string) =>
    request<{ success: boolean; latencyMs?: number; error?: string; model?: string }>(
      'POST',
      `/api/providers/${providerId}/models/${modelId}/test`,
    ),
  /** 服务商附加服务 CRUD（当前仅文件存储） */
  addProviderService: (providerId: string, data: Omit<ProviderServiceItem, 'id'>) =>
    request<ProviderServiceItem>('POST', `/api/providers/${providerId}/services`, data),
  updateProviderService: (providerId: string, serviceId: string, patch: Partial<ProviderServiceItem>) =>
    request<ProviderServiceItem>(
      'PATCH',
      `/api/providers/${providerId}/services/${serviceId}`,
      patch,
    ),
  deleteProviderService: (providerId: string, serviceId: string) =>
    request<{ deleted: boolean }>(
      'DELETE',
      `/api/providers/${providerId}/services/${serviceId}`,
    ),

  // ==========================================================================
  // Agent 管理（见文档 3.2.3）
  // ==========================================================================
  listAgents: () => request<{ agents: AgentItem[]; default: string }>('GET', '/api/agenteam'),
  getAgent: (id: string) => request<AgentDetail>('GET', `/api/agenteam/${id}`),
  createAgent: (data: { name: string; systemPrompt?: string; model?: string; tools?: string[] }) =>
    request<AgentItem>('POST', '/api/agenteam', data),
  updateAgent: (id: string, patch: Partial<AgentDetail>) =>
    request<AgentItem>('PATCH', `/api/agenteam/${id}`, patch),
  deleteAgent: (id: string) => request<{ deleted: boolean }>('DELETE', `/api/agenteam/${id}`),
  setDefaultAgent: (id: string) =>
    request<{ default: string }>('PUT', '/api/agenteam/default', { id }),

  // ==========================================================================
  // Skills / Specs（见文档 3.2.5 / 3.2.6）
  // ==========================================================================
  listSkills: () => request<{ skills: SkillItem[] }>('GET', '/api/skills'),
  getSkill: (name: string) => request<{ skill: SkillDetail }>('GET', `/api/skills/${name}`),
  updateSkill: (name: string, patch: { enabled: boolean }) =>
    request<{ name: string; enabled: boolean }>('PATCH', `/api/skills/${encodeURIComponent(name)}`, patch),
  /** 新建目录式技能（写 ~/.moss/skills/<name>/SKILL.md，watch 热重载生效） */
  createSkill: (data: { name: string; description: string; prompt?: string; icon?: string; greet?: string }) =>
    request<{ name: string }>('POST', '/api/skills', data),
  /** 导入技能（前端 zip 解包：文本 content / 二进制 base64；批量写入技能目录） */
  importSkill: (data: {
    name: string;
    files: Array<{ path: string; content?: string; base64?: string }>;
  }) =>
    request<{ name: string; files: number }>('POST', '/api/skills/import', data),
  /** 自定义斜杠命令列表（~/.moss/commands/<name>.md；含 prompt 供前端渲染注入） */
  listCommands: () => request<{ commands: CommandItem[] }>('GET', '/api/commands'),
  /** 创建自定义斜杠命令（写 <name>.md，热重载自动生效） */
  createCommand: (data: CommandUpsertBody) =>
    request<{ name: string }>('POST', '/api/commands', data),
  /** 更新自定义斜杠命令内容（重写 <name>.md；禁止改名） */
  updateCommand: (name: string, data: CommandUpsertBody) =>
    request<{ name: string }>('PUT', `/api/commands/${encodeURIComponent(name)}`, data),
  /** 删除自定义斜杠命令（删 <name>.md 文件） */
  deleteCommand: (name: string) =>
    request<{ name: string }>('DELETE', `/api/commands/${encodeURIComponent(name)}`),
  /** 切换命令启停（写 config.commands[name].enabled，热生效） */
  toggleCommand: (name: string, enabled: boolean) =>
    request<{ name: string; enabled: boolean }>('PATCH', `/api/commands/${encodeURIComponent(name)}`, { enabled }),
  listSpecs: () => request<{ specs: SpecItem[] }>('GET', '/api/specs'),
  // detail 用 query 形式规避路径参数含斜杠问题
  getSpec: (id: string) =>
    request<{ spec: SpecDetail }>('GET', `/api/specs?id=${encodeURIComponent(id)}`),
  /** 保存 spec 内容（仅用户目录 spec 可编辑；id 走 query 与后端一致） */
  updateSpec: (id: string, content: string, description?: string) =>
    request<{ saved: boolean; id: string }>(
      'PUT',
      `/api/specs?id=${encodeURIComponent(id)}`,
      { content, description },
    ),
  /** 新建 spec（用户 spec 目录下创建 <id>.md，watch 热重载生效） */
  createSpec: (data: { id: string; description?: string }) =>
    request<{ id: string }>('POST', '/api/specs', data),

  // ==========================================================================
  // 规则引擎（/api/rules；cwd 走 query）
  // ==========================================================================
  listRules: (cwd?: string) =>
    request<RulesListResult>('GET', `/api/rules${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`),
  getRule: (id: string, cwd?: string) =>
    request<RuleItem>('GET', `/api/rules/${encodeURIComponent(id)}${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`),
  createRule: (data: RuleUpsertBody, cwd?: string) =>
    request<RuleItem>('POST', `/api/rules${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`, data),
  updateRule: (id: string, data: RuleUpsertBody, cwd?: string) =>
    request<RuleItem>('PATCH', `/api/rules/${encodeURIComponent(id)}${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`, data),
  deleteRule: (id: string, cwd?: string) =>
    request<{ ok: boolean }>('DELETE', `/api/rules/${encodeURIComponent(id)}${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`),

  // ==========================================================================
  // 钩子引擎（/api/hooks）
  // ==========================================================================
  listHooks: (cwd?: string) =>
    request<HooksListResult>('GET', `/api/hooks${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`),
  getHook: (id: string, cwd?: string) =>
    request<HookItem>('GET', `/api/hooks/${encodeURIComponent(id)}${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`),
  createHook: (data: HookUpsertBody, cwd?: string) =>
    request<HookItem>('POST', `/api/hooks${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`, data),
  updateHook: (id: string, data: HookUpsertBody, cwd?: string) =>
    request<HookItem>('PATCH', `/api/hooks/${encodeURIComponent(id)}${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`, data),
  deleteHook: (id: string, cwd?: string) =>
    request<{ ok: boolean }>('DELETE', `/api/hooks/${encodeURIComponent(id)}${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`),
  testHook: (id: string, sampleInput: { cwd?: string; sessionId?: string; toolName?: string; toolInput?: Record<string, unknown>; prompt?: string }) =>
    request<HookTestResult>('POST', `/api/hooks/${encodeURIComponent(id)}/test`, sampleInput),
  getHookHistory: () =>
    request<{ history: HookHistoryEntry[] }>('GET', '/api/hooks/history'),

  // ==========================================================================
  // 记忆引擎（/api/memory）
  // ==========================================================================
  getMemoryTree: (cwd?: string) =>
    request<MemoryPalaceTree>('GET', `/api/memory/tree${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`),
  listMemory: (opts: { cwd?: string; wing?: string; room?: string; hall?: string; q?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts.cwd) params.set('cwd', opts.cwd);
    if (opts.wing) params.set('wing', opts.wing);
    if (opts.room) params.set('room', opts.room);
    if (opts.hall) params.set('hall', opts.hall);
    if (opts.q) params.set('q', opts.q);
    if (opts.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return request<{ items: MemoryItem[]; count: number }>('GET', `/api/memory${qs ? `?${qs}` : ''}`);
  },
  createMemory: (data: MemoryUpsertBody, cwd?: string) =>
    request<MemoryItem>('POST', `/api/memory${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`, data),
  getMemory: (id: string, cwd?: string) =>
    request<MemoryItem>('GET', `/api/memory/${encodeURIComponent(id)}${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`),
  updateMemory: (id: string, patch: Partial<MemoryUpsertBody>, cwd?: string) =>
    request<MemoryItem>('PATCH', `/api/memory/${encodeURIComponent(id)}${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`, patch),
  deleteMemory: (id: string, cwd?: string) =>
    request<{ ok: boolean }>('DELETE', `/api/memory/${encodeURIComponent(id)}${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`),
  distillMemory: (data: { sessionId: string; cwd?: string }) =>
    request<MemoryDistillResult>('POST', '/api/memory/distill', data),

  // ==========================================================================
  // 自动化任务（见文档 3.2.7）
  // ==========================================================================
  listAutomations: () => request<{ automations: AutomationItem[] }>('GET', '/api/automations'),
  getAutomation: (id: string) => request<AutomationDetail>('GET', `/api/automations/${id}`),
  createAutomation: (data: {
    title: string;
    prompt: string;
    cwd: string;
    description?: string;
    icon?: string;
    agentId?: string;
    scheduleType?: 'cron' | 'once';
    cron?: string;
    runAt?: string;
  }) => request<AutomationItem>('POST', '/api/automations', data),
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

  // ==========================================================================
  // Todo（见文档 3.2.9）
  // ==========================================================================
  listTodos: (sessionId: string) =>
    request<{ todos: TodoItem[] }>('GET', `/api/todos/${sessionId}`),
  setTodos: (sessionId: string, todos: TodoItem[]) =>
    request<{ todos: TodoItem[] }>('PUT', `/api/todos/${sessionId}`, { todos }),

  // ==========================================================================
  // 日志（文件列表 / 行查询过滤 / 过期清理）
  // ==========================================================================
  listLogFiles: () => request<{ files: LogFileInfo[] }>('GET', '/api/logs/files'),
  queryLogs: (opts: { file?: string; minLevel?: LogLevel; search?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (opts.file) qs.set('file', opts.file);
    if (opts.minLevel) qs.set('minLevel', opts.minLevel);
    if (opts.search) qs.set('search', opts.search);
    if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
    if (opts.offset !== undefined) qs.set('offset', String(opts.offset));
    const q = qs.toString();
    return request<LogQueryResult>('GET', `/api/logs${q ? `?${q}` : ''}`);
  },
  cleanupLogs: () => request<{ removed: number }>('POST', '/api/logs/cleanup'),

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
  /** 原生多文件选择对话框（附件"纯路径引用"数据源；后端自动授权父目录进 filesys roots） */
  pickFiles: () =>
    request<{ files: PickedFile[]; grantedRoots?: string[] }>('POST', '/api/filesystem/pick-file'),
  resolveDirectory: (folderName: string, hint?: string) =>
    request<ResolveDirectoryResult>('POST', '/api/filesystem/resolve-directory', {
      folderName,
      hint,
    }),
  suggestPaths: () => request<{ paths: SuggestPath[] }>('GET', '/api/filesystem/suggest-paths'),
  /** # 文件提及菜单：指定目录递归模糊搜索文件名（上限 50 条） */
  searchFiles: (dir: string, q: string) =>
    request<{ files: SearchedFile[] }>(
      'GET',
      `/api/filesystem/search-files?dir=${encodeURIComponent(dir)}&q=${encodeURIComponent(q)}`,
    ),
};
