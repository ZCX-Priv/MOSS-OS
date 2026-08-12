// UI/src/store/index.ts
// 全局状态：Zustand。迁移自 webui/src/store/index.ts 并扩展新切片。
// 切片：会话/消息/输入/生成态/模型/Agent/任务/任务分组/Todo/Context/
//       自动化/插件/Skills/Specs/MCP/配置/WS/面板。

import { create } from 'zustand';
import type {
  AppConfig,
  ApiConfig,
  TaskMessage,
  PendingAsk,
  Session,
  McpServer,
  McpTool,
  TaskItem,
  TaskGroup,
  TodoItem,
  ContextFile,
  ModelItem,
  AgentItem,
  AutomationItem,
  AutomationRun,
  PluginItem,
  SkillItem,
  SpecItem,
  ToolItem,
  SidebarTab,
  SidebarTabType,
} from '../types/api';

// ============================================================================
// State
// ============================================================================

interface UIState {
  // --- 会话 / 消息 ---
  activeSessionId: string | null;
  sessions: Session[];
  messagesBySession: Record<string, TaskMessage[]>;
  /** 是否正在生成（按 sessionId 索引；缺省视为 false） */
  generatingBySession: Record<string, boolean>;
  /** 工具发起的、等待用户回复的提问列表 */
  pendingAsks: PendingAsk[];

  // --- 输入 / 工作目录 ---
  input: string;
  workingDirectory: string;
  /** 最近成功使用的目录（绝对路径），最多 5 条，新条目置顶 */
  recentDirectories: string[];

  // --- 模型 ---
  models: ModelItem[];
  currentModel: string;

  // --- Agent ---
  agents: AgentItem[];
  currentAgent: string;

  // --- 任务 + 分组 ---
  tasks: TaskItem[];
  taskGroups: TaskGroup[];
  activeTaskId: string | null;

  // --- Todo / Context（按 sessionId 索引） ---
  todosBySession: Record<string, TodoItem[]>;
  contextBySession: Record<
    string,
    { files: ContextFile[]; totalTokens: number; maxTokens: number }
  >;

  // --- 自动化 ---
  automations: AutomationItem[];
  automationHistory: Record<string, AutomationRun[]>;

  // --- 插件 / Skills / Specs ---
  plugins: PluginItem[];
  skills: SkillItem[];
  specs: SpecItem[];

  // --- 工具（完整列表，含 enabled/source，供工具管理 UI） ---
  tools: ToolItem[];

  // --- 配置 ---
  appConfig: AppConfig | null;
  apiConfig: ApiConfig | null;

  // --- MCP ---
  mcpServers: McpServer[];
  mcpTools: McpTool[];

  // --- 工具图标映射（toolName → icon 字符串，由 /api/tools 拉取） ---
  toolIconMap: Record<string, string>;

  // --- WS ---
  wsStatus: 'connecting' | 'open' | 'closed' | 'error';

  // --- 发送快捷键 ---
  sendShortcut: 'enter' | 'ctrl-enter';

  // --- UI 面板（兼容旧 webui 逻辑，新 UI 当前未直接使用） ---
  activePanel: 'task' | 'config' | 'api-config' | 'mcp' | 'sessions';

  // --- 右侧边栏标签页（全局，localStorage 持久化） ---
  sidebarTabs: SidebarTab[];
  activeSidebarTabId: string | null;
}

// ============================================================================
// Actions
// ============================================================================

interface UIActions {
  // 会话
  setActiveSession: (id: string | null) => void;
  setSessions: (s: Session[]) => void;
  addSession: (s: Session) => void;
  removeSession: (id: string) => void;

  // 消息
  setMessages: (sessionId: string, messages: TaskMessage[]) => void;
  addMessage: (sessionId: string, message: TaskMessage) => void;
  updateMessage: (sessionId: string, messageId: string, patch: Partial<TaskMessage>) => void;
  appendToMessage: (
    sessionId: string,
    messageId: string,
    field: 'content' | 'thinking',
    text: string,
  ) => void;
  /** 合并 appendToMessage + updateMessage(thinkingStreaming) 为单次 set，降低高频流式更新的渲染压力 */
  appendTextAndMarkThinking: (
    sessionId: string,
    messageId: string,
    field: 'content' | 'thinking',
    text: string,
    thinkingStreaming: boolean,
  ) => void;
  clearMessages: (sessionId: string) => void;

  // 生成态
  setGenerating: (sessionId: string, v: boolean) => void;
  /** 将指定 session 中所有 streaming 的消息标记为已完成 */
  finalizeStreamingMessages: (sessionId: string) => void;

  // 输入 / 工作目录
  setInput: (input: string) => void;
  setWorkingDirectory: (cwd: string) => void;
  addRecentDirectory: (dir: string) => void;

  // 模型
  setModels: (models: ModelItem[]) => void;
  setCurrentModel: (m: string) => void;

  // Agent
  setAgents: (a: AgentItem[]) => void;
  setCurrentAgent: (id: string) => void;

  // 任务 + 分组
  setTasks: (tasks: TaskItem[]) => void;
  setTaskGroups: (groups: TaskGroup[]) => void;
  addTask: (task: TaskItem) => void;
  updateTask: (id: string, patch: Partial<TaskItem>) => void;
  removeTask: (id: string) => void;
  setActiveTaskId: (id: string | null) => void;
  addTaskGroup: (group: TaskGroup) => void;
  updateTaskGroup: (id: string, patch: Partial<TaskGroup>) => void;
  removeTaskGroup: (id: string) => void;

  // Todo / Context
  setTodos: (sessionId: string, todos: TodoItem[]) => void;
  setContext: (
    sessionId: string,
    ctx: { files: ContextFile[]; totalTokens: number; maxTokens: number },
  ) => void;

  // 自动化
  setAutomations: (a: AutomationItem[]) => void;
  addAutomation: (a: AutomationItem) => void;
  updateAutomation: (id: string, patch: Partial<AutomationItem>) => void;
  removeAutomation: (id: string) => void;
  setAutomationHistory: (id: string, history: AutomationRun[]) => void;
  addAutomationRun: (id: string, run: AutomationRun) => void;
  updateAutomationRun: (id: string, runId: string, patch: Partial<AutomationRun>) => void;

  // 插件 / Skills / Specs
  setPlugins: (p: PluginItem[]) => void;
  updatePlugin: (id: string, patch: Partial<PluginItem>) => void;
  setSkills: (s: SkillItem[]) => void;
  setSpecs: (s: SpecItem[]) => void;

  // 工具
  setTools: (t: ToolItem[]) => void;
  updateTool: (name: string, patch: Partial<ToolItem>) => void;

  // 配置
  setAppConfig: (c: AppConfig | null) => void;
  setApiConfig: (c: ApiConfig | null) => void;

  // MCP
  setMcpServers: (s: McpServer[]) => void;
  setMcpTools: (t: McpTool[]) => void;

  // 工具图标映射
  setToolIconMap: (map: Record<string, string>) => void;

  // PendingAsk
  addPendingAsk: (ask: PendingAsk) => void;
  removePendingAsk: (toolCallId: string) => void;
  clearPendingAsks: () => void;
  /** 仅清除指定 session 的 pendingAsks */
  clearPendingAsksBySession: (sessionId: string) => void;

  // WS
  setWsStatus: (s: UIState['wsStatus']) => void;

  // 发送快捷键
  setSendShortcut: (v: UIState['sendShortcut']) => void;

  // 面板
  setActivePanel: (p: UIState['activePanel']) => void;

  // 右侧边栏标签页
  /** 新建标签页，返回新标签 id；自动设为活跃 */
  addSidebarTab: (type: SidebarTabType, title: string, toolCallId?: string) => string;
  /** 删除标签页；若删的是活跃标签则自动切到最后一个；删空则重建默认 summary */
  removeSidebarTab: (id: string) => void;
  /** 设置活跃标签页 */
  setActiveSidebarTab: (id: string) => void;
  /** 重命名标签页 */
  renameSidebarTab: (id: string, title: string) => void;
}

export type Store = UIState & UIActions;

// ============================================================================
// Store 实现
// ============================================================================

export const useStore = create<Store>((set) => ({
  // --- 会话 / 消息 ---
  activeSessionId: null,
  sessions: [],
  messagesBySession: {},
  generatingBySession: {},
  pendingAsks: [],

  // --- 输入 / 工作目录 ---
  input: '',
  workingDirectory: '',
  recentDirectories: [],

  // --- 模型 ---
  models: [],
  currentModel: '',

  // --- Agent ---
  agents: [],
  currentAgent: '',

  // --- 任务 + 分组 ---
  tasks: [],
  taskGroups: [],
  activeTaskId: null,

  // --- Todo / Context ---
  todosBySession: {},
  contextBySession: {},

  // --- 自动化 ---
  automations: [],
  automationHistory: {},

  // --- 插件 / Skills / Specs ---
  plugins: [],
  skills: [],
  specs: [],

  // --- 工具 ---
  tools: [],

  // --- 配置 ---
  appConfig: null,
  apiConfig: null,

  // --- MCP ---
  mcpServers: [],
  mcpTools: [],

  // --- 工具图标映射 ---
  toolIconMap: {},

  // --- WS ---
  wsStatus: 'closed',

  // --- 发送快捷键 ---
  sendShortcut:
    (localStorage.getItem('moss-send-shortcut') as 'enter' | 'ctrl-enter') ||
    'ctrl-enter',

  // --- 右侧边栏标签页（localStorage 持久化） ---
  sidebarTabs: (() => {
    try {
      const raw = localStorage.getItem('moss-sidebar-tabs');
      if (raw) {
        const tabs = JSON.parse(raw) as SidebarTab[];
        if (Array.isArray(tabs) && tabs.length > 0) return tabs;
      }
    } catch {
      // 静默回退
    }
    return [
      {
        id: 'default-summary',
        type: 'summary' as const,
        title: 'task.taskSummary',
        createdAt: Date.now(),
      },
    ];
  })(),
  activeSidebarTabId: (() => {
    try {
      return localStorage.getItem('moss-active-sidebar-tab') || 'default-summary';
    } catch {
      return 'default-summary';
    }
  })(),

  // --- 面板 ---
  activePanel: 'task',

  // --- Actions: 会话 ---
  setActiveSession: (id) => set({ activeSessionId: id }),
  setSessions: (sessions) => set({ sessions }),
  addSession: (s) => set((state) => ({ sessions: [...state.sessions, s] })),
  removeSession: (id) =>
    set((state) => {
      const { [id]: _omit, ...restMessages } = state.messagesBySession;
      const { [id]: _omitGen, ...restGen } = state.generatingBySession;
      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        messagesBySession: restMessages,
        generatingBySession: restGen,
        activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
      };
    }),

  // --- Actions: 消息 ---
  setMessages: (sessionId, messages) =>
    set((state) => ({
      messagesBySession: { ...state.messagesBySession, [sessionId]: messages },
    })),
  addMessage: (sessionId, message) =>
    set((state) => ({
      messagesBySession: {
        ...state.messagesBySession,
        [sessionId]: [...(state.messagesBySession[sessionId] ?? []), message],
      },
    })),
  updateMessage: (sessionId, messageId, patch) =>
    set((state) => ({
      messagesBySession: {
        ...state.messagesBySession,
        [sessionId]: (state.messagesBySession[sessionId] ?? []).map((m) =>
          m.id === messageId ? { ...m, ...patch } : m,
        ),
      },
    })),
  appendToMessage: (sessionId, messageId, field, text) =>
    set((state) => ({
      messagesBySession: {
        ...state.messagesBySession,
        [sessionId]: (state.messagesBySession[sessionId] ?? []).map((m) =>
          m.id === messageId ? { ...m, [field]: (m[field] ?? '') + text } : m,
        ),
      },
    })),
  appendTextAndMarkThinking: (sessionId, messageId, field, text, thinkingStreaming) =>
    set((state) => ({
      messagesBySession: {
        ...state.messagesBySession,
        [sessionId]: (state.messagesBySession[sessionId] ?? []).map((m) =>
          m.id === messageId
            ? { ...m, [field]: (m[field] ?? '') + text, thinkingStreaming }
            : m,
        ),
      },
    })),
  clearMessages: (sessionId) =>
    set((state) => ({
      messagesBySession: { ...state.messagesBySession, [sessionId]: [] },
    })),

  // --- Actions: 生成态 ---
  setGenerating: (sessionId, v) =>
    set((state) => ({
      generatingBySession: { ...state.generatingBySession, [sessionId]: v },
    })),
  finalizeStreamingMessages: (sessionId) =>
    set((state) => ({
      messagesBySession: {
        ...state.messagesBySession,
        [sessionId]: (state.messagesBySession[sessionId] ?? []).map((m) => {
          if (!m.streaming) return m;
          const finalizedToolCalls = m.toolCalls?.map((tc) =>
            tc.status === 'done' ? tc : { ...tc, status: 'done' as const },
          );
          return { ...m, streaming: false, thinkingStreaming: false, toolCalls: finalizedToolCalls };
        }),
      },
    })),

  // --- Actions: 输入 / 工作目录 ---
  setInput: (input) => set({ input }),
  setWorkingDirectory: (workingDirectory) => set({ workingDirectory }),
  addRecentDirectory: (dir) =>
    set((state) => {
      const trimmed = dir.trim();
      if (!trimmed) return state;
      const rest = state.recentDirectories.filter((d) => d !== trimmed);
      return { recentDirectories: [trimmed, ...rest].slice(0, 5) };
    }),

  // --- Actions: 模型 ---
  setModels: (models) => set({ models }),
  setCurrentModel: (currentModel) => set({ currentModel }),

  // --- Actions: Agent ---
  setAgents: (agents) => set({ agents }),
  setCurrentAgent: (currentAgent) => set({ currentAgent }),

  // --- Actions: 任务 + 分组 ---
  setTasks: (tasks) => set({ tasks }),
  setTaskGroups: (taskGroups) => set({ taskGroups }),
  addTask: (task) => set((state) => ({ tasks: [task, ...state.tasks] })),
  updateTask: (id, patch) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  removeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
      activeTaskId: state.activeTaskId === id ? null : state.activeTaskId,
    })),
  setActiveTaskId: (activeTaskId) => set({ activeTaskId }),
  addTaskGroup: (group) => set((state) => ({ taskGroups: [...state.taskGroups, group] })),
  updateTaskGroup: (id, patch) =>
    set((state) => ({
      taskGroups: state.taskGroups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    })),
  removeTaskGroup: (id) =>
    set((state) => ({ taskGroups: state.taskGroups.filter((g) => g.id !== id) })),

  // --- Actions: Todo / Context ---
  setTodos: (sessionId, todos) =>
    set((state) => ({
      todosBySession: { ...state.todosBySession, [sessionId]: todos },
    })),
  setContext: (sessionId, ctx) =>
    set((state) => ({
      contextBySession: { ...state.contextBySession, [sessionId]: ctx },
    })),

  // --- Actions: 自动化 ---
  setAutomations: (automations) => set({ automations }),
  addAutomation: (a) => set((state) => ({ automations: [...state.automations, a] })),
  updateAutomation: (id, patch) =>
    set((state) => ({
      automations: state.automations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),
  removeAutomation: (id) =>
    set((state) => ({ automations: state.automations.filter((a) => a.id !== id) })),
  setAutomationHistory: (id, history) =>
    set((state) => ({
      automationHistory: { ...state.automationHistory, [id]: history },
    })),
  addAutomationRun: (id, run) =>
    set((state) => ({
      automationHistory: {
        ...state.automationHistory,
        [id]: [run, ...(state.automationHistory[id] ?? [])],
      },
    })),
  updateAutomationRun: (id, runId, patch) =>
    set((state) => ({
      automationHistory: {
        ...state.automationHistory,
        [id]: (state.automationHistory[id] ?? []).map((r) =>
          r.id === runId ? { ...r, ...patch } : r,
        ),
      },
    })),

  // --- Actions: 插件 / Skills / Specs ---
  setPlugins: (plugins) => set({ plugins }),
  updatePlugin: (id, patch) =>
    set((state) => ({
      plugins: state.plugins.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),
  setSkills: (skills) => set({ skills }),
  setSpecs: (specs) => set({ specs }),

  // --- Actions: 工具 ---
  setTools: (tools) => set({ tools }),
  updateTool: (name, patch) =>
    set((state) => ({
      tools: state.tools.map((t) => (t.name === name ? { ...t, ...patch } : t)),
    })),

  // --- Actions: 配置 ---
  setAppConfig: (appConfig) => set({ appConfig }),
  setApiConfig: (apiConfig) => set({ apiConfig }),

  // --- Actions: MCP ---
  setMcpServers: (mcpServers) => set({ mcpServers }),
  setMcpTools: (mcpTools) => set({ mcpTools }),

  // --- Actions: 工具图标映射 ---
  setToolIconMap: (toolIconMap) => set({ toolIconMap }),

  // --- Actions: PendingAsk ---
  addPendingAsk: (ask) =>
    set((state) => ({
      pendingAsks: [
        ...state.pendingAsks.filter((a) => a.toolCallId !== ask.toolCallId),
        ask,
      ],
    })),
  removePendingAsk: (toolCallId) =>
    set((state) => ({
      pendingAsks: state.pendingAsks.filter((a) => a.toolCallId !== toolCallId),
    })),
  clearPendingAsks: () => set({ pendingAsks: [] }),
  clearPendingAsksBySession: (sessionId) =>
    set((state) => ({
      pendingAsks: state.pendingAsks.filter((a) => a.sessionId !== sessionId),
    })),

  // --- Actions: WS ---
  setWsStatus: (wsStatus) => set({ wsStatus }),

  // --- Actions: 发送快捷键 ---
  setSendShortcut: (sendShortcut) => {
    localStorage.setItem('moss-send-shortcut', sendShortcut);
    set({ sendShortcut });
  },

  // --- Actions: 面板 ---
  setActivePanel: (activePanel) => set({ activePanel }),

  // --- Actions: 右侧边栏标签页 ---
  addSidebarTab: (type, title, toolCallId) => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tab: SidebarTab = { id, type, title, toolCallId, createdAt: Date.now() };
    set((state) => {
      const tabs = [...state.sidebarTabs, tab];
      try {
        localStorage.setItem('moss-sidebar-tabs', JSON.stringify(tabs));
        localStorage.setItem('moss-active-sidebar-tab', id);
      } catch {
        // 静默
      }
      return { sidebarTabs: tabs, activeSidebarTabId: id };
    });
    return id;
  },

  removeSidebarTab: (id) =>
    set((state) => {
      let tabs = state.sidebarTabs.filter((t) => t.id !== id);
      let activeId = state.activeSidebarTabId;
      // 删空则重建默认 summary 标签
      if (tabs.length === 0) {
        tabs = [
          {
            id: 'default-summary',
            type: 'summary',
            title: 'task.taskSummary',
            createdAt: Date.now(),
          },
        ];
        activeId = 'default-summary';
      } else if (activeId === id) {
        // 删的是活跃标签 → 切到最后一个
        activeId = tabs[tabs.length - 1].id;
      }
      try {
        localStorage.setItem('moss-sidebar-tabs', JSON.stringify(tabs));
        localStorage.setItem('moss-active-sidebar-tab', activeId ?? '');
      } catch {
        // 静默
      }
      return { sidebarTabs: tabs, activeSidebarTabId: activeId };
    }),

  setActiveSidebarTab: (id) => {
    try {
      localStorage.setItem('moss-active-sidebar-tab', id);
    } catch {
      // 静默
    }
    set({ activeSidebarTabId: id });
  },

  renameSidebarTab: (id, title) =>
    set((state) => {
      const tabs = state.sidebarTabs.map((t) =>
        t.id === id ? { ...t, title } : t,
      );
      try {
        localStorage.setItem('moss-sidebar-tabs', JSON.stringify(tabs));
      } catch {
        // 静默
      }
      return { sidebarTabs: tabs };
    }),
}));
