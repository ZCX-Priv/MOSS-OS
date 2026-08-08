// UI/src/store/index.ts
// 全局状态：Zustand。迁移自 webui/src/store/index.ts 并扩展新切片。
// 切片：会话/消息/输入/生成态/模型/Agent/任务/任务分组/Todo/Context/
//       自动化/插件/Skills/Specs/MCP/配置/WS/面板。

import { create } from 'zustand';
import type {
  AppConfig,
  ApiConfig,
  ChatMessage,
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
} from '../types/api';

// ============================================================================
// State
// ============================================================================

interface UIState {
  // --- 会话 / 消息 ---
  activeSessionId: string | null;
  sessions: Session[];
  messagesBySession: Record<string, ChatMessage[]>;
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
  activePanel: 'chat' | 'config' | 'api-config' | 'mcp' | 'sessions';
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
  setMessages: (sessionId: string, messages: ChatMessage[]) => void;
  addMessage: (sessionId: string, message: ChatMessage) => void;
  updateMessage: (sessionId: string, messageId: string, patch: Partial<ChatMessage>) => void;
  appendToMessage: (
    sessionId: string,
    messageId: string,
    field: 'content' | 'thinking',
    text: string,
  ) => void;
  clearMessages: (sessionId: string) => void;

  // 生成态
  setGenerating: (sessionId: string, v: boolean) => void;

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

  // WS
  setWsStatus: (s: UIState['wsStatus']) => void;

  // 发送快捷键
  setSendShortcut: (v: UIState['sendShortcut']) => void;

  // 面板
  setActivePanel: (p: UIState['activePanel']) => void;
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
    (localStorage.getItem('moss-os-send-shortcut') as 'enter' | 'ctrl-enter') ||
    'ctrl-enter',

  // --- 面板 ---
  activePanel: 'chat',

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
  clearMessages: (sessionId) =>
    set((state) => ({
      messagesBySession: { ...state.messagesBySession, [sessionId]: [] },
    })),

  // --- Actions: 生成态 ---
  setGenerating: (sessionId, v) =>
    set((state) => ({
      generatingBySession: { ...state.generatingBySession, [sessionId]: v },
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
  addTask: (task) => set((state) => ({ tasks: [...state.tasks, task] })),
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

  // --- Actions: WS ---
  setWsStatus: (wsStatus) => set({ wsStatus }),

  // --- Actions: 发送快捷键 ---
  setSendShortcut: (sendShortcut) => {
    localStorage.setItem('moss-os-send-shortcut', sendShortcut);
    set({ sendShortcut });
  },

  // --- Actions: 面板 ---
  setActivePanel: (activePanel) => set({ activePanel }),
}));
