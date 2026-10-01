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
  ToolResult,
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
  Agenteam,
  AgenteamSummary,
  AgenteamProfile,
  CreateAgenteamInput,
  TeamMessage,
  SubagentRunOutput,
  SkillItem,
  SkillDetail,
  CommandItem,
  CommandUpsertBody,
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
  RemoteStatus,
  RemotePasswords,
  RemoteToggleResult,
  HistoryPageMeta,
  SessionState,
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
 *
 * id 策略（分页/虚拟列表的稳定标识）：
 * - 分页接口会为每条消息附带服务端绝对 index → id = `h<index>`，
 *   分页前后同一消息 id 恒定（避免上滑加载更早一页后 key 漂移导致整列表重挂载）。
 * - 旧的全量路径无 index → 退化为位置 id（与既有行为一致）。
 */
function adaptAgentMessages(raw: unknown[]): TaskMessage[] {
  const result: TaskMessage[] = [];
  const list = Array.isArray(raw) ? raw : [];
  /**
   * 未能就近合并的工具结果（前一条不是 assistant）。
   * 典型场景：用户在长耗时工具（subagent / 建队）执行中又发了消息，
   * 结果消息的「前一条」变成 user —— 旧实现会直接丢弃它，
   * 导致刷新后卡片拿不到报告/teamId。这里先挂起，循环结束后按 toolCallId
   * 回填到真正发起该调用的 assistant 消息上。
   */
  const orphanToolResults: Array<{ toolCallId: string; result: ToolResult }> = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i] as {
      role?: string;
      content?: string;
      /** 用户消息附带的附件绝对路径（后端结构化字段） */
      attachments?: string[];
      toolCalls?: Array<{ id: string; name: string; arguments: string }>;
      toolCallId?: string;
      name?: string;
      thinking?: string;
      todoSnapshot?: TaskMessage['todoSnapshot'];
      isError?: boolean;
      metadata?: Record<string, unknown>;
      timestamp?: string;
      /** 服务端绝对下标（分页接口附带；全量接口无） */
      index?: number;
      /** 前端下发并由后端持久化的消息身份（仅 user 消息可能有） */
      clientMessageId?: string;
    } | null;
    if (!m) continue;
    if (m.role === 'system') continue;
    // 稳定 id 优先级：
    // ① clientMessageId —— 用户消息的真实身份，与本地乐观副本一致（据此去重，避免渲染两份）
    // ② 服务端绝对下标（分页路径稳定）  ③ 位置 id（旧全量路径兜底）
    const msgId =
      (typeof m.clientMessageId === 'string' && m.clientMessageId) ||
      (typeof m.index === 'number' ? `h${m.index}` : `${i}-${m.role ?? 'msg'}`);
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
        id: typeof m.index === 'number' ? `h${m.index}` : `${i}-max-turns-notice`,
        role: 'assistant',
        content: m.content ?? '',
        maxTurnsNotice: { maxTurns: typeof noticeMeta?.maxTurns === 'number' ? noticeMeta.maxTurns : 0 },
        timestamp: m.timestamp ?? new Date().toISOString(),
        ...(typeof m.index === 'number' ? { historyIndex: m.index } : {}),
      });
      continue;
    }
    if (m.role === 'tool') {
      const entry = {
        toolCallId: m.toolCallId ?? '',
        result: {
          content: [{ type: 'text' as const, text: m.content ?? '' }],
          ...(m.isError ? { isError: true } : {}),
          ...(m.metadata ? { metadata: m.metadata } : {}),
        },
      };
      // 优先就近合并到前一条 assistant；前一条不是 assistant 时挂起，稍后按 toolCallId 回填
      const prev = result[result.length - 1];
      if (prev && prev.role === 'assistant') {
        prev.toolResults = prev.toolResults ?? [];
        prev.toolResults.push(entry);
      } else {
        orphanToolResults.push(entry);
      }
      continue;
    }
    // user / assistant
    result.push({
      id: msgId,
      role: m.role as MessageRole,
      content: m.content ?? '',
      ...(typeof m.index === 'number' ? { historyIndex: m.index } : {}),
      // 附件结构化字段：仅 user 消息且为有效数组时透传（老会话无此字段 → 渲染端回退解析正文）
      ...(m.role === 'user' && Array.isArray(m.attachments) && m.attachments.length > 0
        ? { attachments: m.attachments }
        : {}),
      // 消息身份（仅 user 消息可能有）：与 id 同源，便于调试与后续按身份合并
      ...(m.role === 'user' && typeof m.clientMessageId === 'string' && m.clientMessageId
        ? { clientMessageId: m.clientMessageId }
        : {}),
      thinking: m.thinking,
      toolCalls: m.toolCalls,
      todoSnapshot: m.todoSnapshot,
      // 历史恢复保留错误标记（否则刷新后错误消息变成普通正文渲染）
      ...(m.isError ? { isError: true } : {}),
      timestamp: m.timestamp ?? new Date().toISOString(),
    });
  }
  // 回填挂起的工具结果：按 toolCallId 找到真正发起该调用的 assistant 消息
  for (const entry of orphanToolResults) {
    const owner = result.find(
      (msg) => msg.role === 'assistant' && msg.toolCalls?.some((tc) => tc.id === entry.toolCallId),
    );
    if (!owner) continue; // 无归属（如已被截断）：丢弃，避免污染其他消息
    owner.toolResults = owner.toolResults ?? [];
    owner.toolResults.push(entry);
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
  /**
   * 会话历史（支持分页）。
   * - 不传参：全量（保持旧调用方兼容）
   * - limit：最新 limit 条（首屏）
   * - limit + before：更早的一页（上滑加载）
   * - limit + after：尾部增量（断线/完成后的补齐）
   * 分页路径返回 page 元数据，每条消息带服务端绝对 index（前端据此生成稳定 id）。
   */
  getSessionHistory: async (
    id: string,
    opts?: { limit?: number; before?: number; after?: number },
  ) => {
    const qs = new URLSearchParams();
    if (opts?.limit !== undefined) qs.set('limit', String(opts.limit));
    if (opts?.before !== undefined) qs.set('before', String(opts.before));
    if (opts?.after !== undefined) qs.set('after', String(opts.after));
    const q = qs.toString();
    const resp = await request<{
      sessionId: string;
      messages: unknown[];
      page?: HistoryPageMeta;
      activeSkill?: { name: string; mode: 'system' | 'message' } | null;
      permissionMode?: 'ask' | 'auto' | 'skip';
      lastRunStats?: RunStats;
    }>('GET', `/api/session/${id}${q ? `?${q}` : ''}`);
    return {
      sessionId: resp.sessionId,
      messages: adaptAgentMessages(resp.messages),
      ...(resp.page ? { page: resp.page } : {}),
      ...(resp.permissionMode ? { permissionMode: resp.permissionMode } : {}),
      ...(resp.lastRunStats ? { lastRunStats: resp.lastRunStats } : {}),
    };
  },
  /** 会话状态快照：运行态 + 半截流式草稿 + 待答/待确认（刷新/重连恢复的唯一入口） */
  getSessionState: (id: string) =>
    request<SessionState>('GET', `/api/session/${encodeURIComponent(id)}/state`),
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
  updateTool: (name: string, patch: { enabled?: boolean; config?: Record<string, unknown> }) =>
    request<{ name: string; config?: Record<string, unknown> }>('PATCH', `/api/tools/${encodeURIComponent(name)}`, patch),

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
    request<{
      providers: ProviderItem[];
      current: string;
      /** 默认搜索引擎（web 工具消费）：空串 = 本地免费引擎链 */
      currentSearchProvider?: string;
    }>('GET', '/api/providers'),
  setCurrentModel: (modelId: string) =>
    request<{ current: string }>('PUT', '/api/providers/current', { modelId }),
  /** 设置默认搜索引擎（providerId 空串 = 本地免费引擎） */
  setSearchCurrentProvider: (providerId: string) =>
    request<{ currentSearchProvider: string }>('PUT', '/api/providers/search-current', {
      providerId,
    }),
  createProvider: (data: {
    name: string;
    /** 服务商类型：model（缺省）= 模型服务商；search = 搜索服务商 */
    kind?: 'model' | 'search';
    format?: ProviderItem['format'];
    /** 搜索引擎（kind='search' 必填）：zhipu / bocha / tavily */
    searchEngine?: 'zhipu' | 'bocha' | 'tavily';
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
  // agenteam 编排（见 routes/agenteams.ts）
  // ==========================================================================
  listAgenteams: () => request<{ teams: AgenteamSummary[] }>('GET', '/api/agenteams'),
  getAgenteam: (id: string) => request<Agenteam>('GET', `/api/agenteams/${id}`),
  getAgenteamMessages: (id: string, since?: number) =>
    request<{ messages: TeamMessage[] }>(
      'GET',
      `/api/agenteams/${id}/messages${since !== undefined ? `?since=${since}` : ''}`,
    ),
  createAgenteam: (data: CreateAgenteamInput) => request<Agenteam>('POST', '/api/agenteams', data),
  approveAgenteam: (id: string) => request<Agenteam>('POST', `/api/agenteams/${id}/approve`),
  discardAgenteam: (id: string) => request<Agenteam>('POST', `/api/agenteams/${id}/discard`),
  haltAgenteam: (id: string) => request<Agenteam>('POST', `/api/agenteams/${id}/halt`),
  resumeAgenteam: (id: string) => request<Agenteam>('POST', `/api/agenteams/${id}/resume`),
  deleteAgenteam: (id: string) => request<{ deleted: boolean }>('DELETE', `/api/agenteams/${id}`),
  listAgenteamProfiles: () => request<{ profiles: AgenteamProfile[] }>('GET', '/api/agenteam-profiles'),
  saveAgenteamProfile: (data: AgenteamProfile) =>
    request<{ saved: boolean }>('POST', '/api/agenteam-profiles', data),
  deleteAgenteamProfile: (name: string) =>
    request<{ deleted: boolean }>('DELETE', `/api/agenteam-profiles/${encodeURIComponent(name)}`),
  runSubagent: (data: { template: string; task: string; cwd: string; permissionMode?: 'ask' | 'auto' | 'skip' }) =>
    request<SubagentRunOutput>('POST', '/api/subagents/run', data),

  // ==========================================================================
  // Skills（见文档 3.2.5）
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
  // 远程控制（/api/remote/*）
  // ==========================================================================
  getRemoteStatus: () => request<RemoteStatus>('GET', '/api/remote/status'),
  getRemotePasswords: () => request<RemotePasswords>('GET', '/api/remote/passwords'),
  enableRemote: () => request<RemoteToggleResult>('POST', '/api/remote/enable'),
  disableRemote: () => request<RemoteToggleResult>('POST', '/api/remote/disable'),
  setRemoteLan: (enabled: boolean) => request<{ lanEnabled: boolean }>('POST', '/api/remote/lan', { enabled }),
  setRemoteLanPassword: (action: 'refresh' | 'custom' | 'disable' | 'enable', value?: string) =>
    request<{ pin?: string; lanPasswordEnabled?: boolean }>('POST', '/api/remote/lan/password', { action, value }),
  setRemoteLanIp: (ip: string) => request<{ lanIpOverride: string }>('POST', '/api/remote/lan-ip', { ip }),
  startRemoteTunnel: (disclaimerAccepted: boolean) =>
    request<{ url: string; phase: string }>('POST', '/api/remote/tunnel/start', { disclaimerAccepted }),
  stopRemoteTunnel: () => request<{ stopped: boolean }>('POST', '/api/remote/tunnel/stop'),
  setRemoteTunnelPassword: (action: 'refresh' | 'custom', value?: string) =>
    request<{ pin?: string }>('POST', '/api/remote/tunnel/password', { action, value }),

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
