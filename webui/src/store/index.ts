// UI/src/store/index.ts
// 全局状态：Zustand。迁移自 webui/src/store/index.ts 并扩展新切片。
// 切片：会话/消息/输入/生成态/模型/Agent/任务/任务分组/Todo/Context/
//       自动化/插件/Skills/Specs/MCP/配置/WS/面板。

import { create } from 'zustand';
import { idbSet } from '../utils/idb';
import type {
  AppConfig,
  ApiConfig,
  TaskMessage,
  PendingAsk,
  PendingConfirm,
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
  SkillItem,
  SpecItem,
  ToolItem,
  ActiveSkillState,
  SidebarTab,
  SidebarTabType,
  PermissionMode,
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

  /** 工具发起的、等待用户确认的请求列表 */
  pendingConfirms: PendingConfirm[];

  /** 消息撤回备份（redo 用）：sessionId → 被删消息快照与截断起点 */
  truncateBackups: Record<string, {
    /** 截断起点时间戳（恢复定位用） */
    messageTimestamp: string;
    /** 被删除的前端消息（按原顺序） */
    messages: TaskMessage[];
  } | undefined>;

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

  // --- Skills / Specs ---
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

  // --- Skill 模式（会话级；skill-mode 事件维护） ---
  activeSkillBySession: Record<string, ActiveSkillState | undefined>;

  // --- 工具图标映射（toolName → icon 字符串，由 /api/tools 拉取） ---
  toolIconMap: Record<string, string>;

  // --- WS ---
  wsStatus: 'connecting' | 'open' | 'closed' | 'error';

  // --- 发送快捷键 ---
  sendShortcut: 'enter' | 'ctrl-enter';

  // --- 执行权限模式 ---
  permissionMode: PermissionMode;

  // --- 右侧边栏标签页（全局，IndexedDB 持久化） ---
  sidebarTabs: SidebarTab[];
  activeSidebarTabId: string | null;
}

/** 从 IndexedDB 预填充后写入 store 的持久化状态（各字段可选，值非法时忽略） */
export interface PersistedState {
  workingDirectory?: string;
  recentDirectories?: string[];
  sendShortcut?: 'enter' | 'ctrl-enter';
  permissionMode?: PermissionMode;
  sidebarTabs?: SidebarTab[];
  activeSidebarTabId?: string;
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
  touchTask: (id: string) => void;
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

  // Skills / Specs
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

  // Skill 模式（skill-mode 事件：enter/switch 设置，exit/error 清除）
  setActiveSkill: (sessionId: string, skill: ActiveSkillState | undefined) => void;

  // 工具图标映射
  setToolIconMap: (map: Record<string, string>) => void;

  // PendingAsk
  addPendingAsk: (ask: PendingAsk) => void;
  removePendingAsk: (toolCallId: string) => void;
  clearPendingAsks: () => void;
  /** 仅清除指定 session 的 pendingAsks */
  clearPendingAsksBySession: (sessionId: string) => void;

  // 消息撤回备份
  setTruncateBackup: (sessionId: string, backup: { messageTimestamp: string; messages: TaskMessage[] } | undefined) => void;

  // PendingConfirm
  addPendingConfirm: (confirm: PendingConfirm) => void;
  removePendingConfirm: (toolCallId: string) => void;
  clearPendingConfirmsBySession: (sessionId: string) => void;

  // WS
  setWsStatus: (s: UIState['wsStatus']) => void;

  // 发送快捷键
  setSendShortcut: (v: UIState['sendShortcut']) => void;

  // 执行权限模式
  setPermissionMode: (v: UIState['permissionMode']) => void;

  // 模型菜单"添加自定义模型"跳转设置页并打开弹窗的信号
  modelDialogRequest: boolean;
  requestModelDialog: () => void;
  clearModelDialogRequest: () => void;

  // 右侧边栏标签页
  /** 新建标签页，返回新标签 id；自动设为活跃 */
  addSidebarTab: (type: SidebarTabType, title: string, toolCallId?: string) => string;
  /** 删除标签页；若删的是活跃标签则自动切到最后一个；删空则重建默认 summary */
  removeSidebarTab: (id: string) => void;
  /** 设置活跃标签页 */
  setActiveSidebarTab: (id: string) => void;
  /** 重命名标签页 */
  renameSidebarTab: (id: string, title: string) => void;
  /** 拖拽重排标签页顺序 */
  reorderSidebarTabs: (fromId: string, toId: string) => void;

  // 持久化状态注入（main.tsx 预填充 IndexedDB 后、渲染前调用）
  hydratePersisted: (patch: PersistedState) => void;
}

export type Store = UIState & UIActions;

// ============================================================================
// 工作目录：默认路径 + IndexedDB 持久化
// ============================================================================

/** 默认工作目录 */
export const DEFAULT_WORKING_DIRECTORY = 'C:\\';

/** 默认右侧边栏 summary 标签 */
function defaultSidebarTab(): SidebarTab {
  return {
    id: 'default-summary',
    type: 'summary',
    title: 'task.taskSummary',
    createdAt: Date.now(),
  };
}

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
  pendingConfirms: [],
  truncateBackups: {},

  // --- 输入 / 工作目录 ---
  input: '',
  workingDirectory: DEFAULT_WORKING_DIRECTORY,
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

  // --- Skills / Specs ---
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
  activeSkillBySession: {},

  // --- 工具图标映射 ---
  toolIconMap: {},

  // --- WS ---
  wsStatus: 'closed',

  // --- 发送快捷键 ---
  sendShortcut: 'ctrl-enter',

  // --- 执行权限模式 ---
  permissionMode: 'ask',

  // 模型菜单"添加自定义模型"跳转设置页并打开弹窗的信号
  modelDialogRequest: false,

  // --- 右侧边栏标签页（IndexedDB 持久化） ---
  sidebarTabs: [defaultSidebarTab()],
  activeSidebarTabId: 'default-summary',

  // --- Actions: 会话 ---
  setActiveSession: (id) => set({ activeSessionId: id }),
  setSessions: (sessions) => set({ sessions }),
  addSession: (s) => set((state) => ({ sessions: [...state.sessions, s] })),
  removeSession: (id) =>
    set((state) => {
      const { [id]: _omit, ...restMessages } = state.messagesBySession;
      const { [id]: _omitGen, ...restGen } = state.generatingBySession;
      const { [id]: _omitTodos, ...restTodos } = state.todosBySession;
      const { [id]: _omitCtx, ...restCtx } = state.contextBySession;
      const { [id]: _omitSkill, ...restSkill } = state.activeSkillBySession;
      const { [id]: _omitBackup, ...restBackups } = state.truncateBackups;
      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        messagesBySession: restMessages,
        generatingBySession: restGen,
        todosBySession: restTodos,
        contextBySession: restCtx,
        activeSkillBySession: restSkill,
        truncateBackups: restBackups,
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
            ? { ...m, [field]: (m[field] ?? '') + text, thinkingStreaming: m.streaming ? thinkingStreaming : false }
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
          // 已 finalize（streaming=false）但 thinkingStreaming 被 rAF 迟到写入复活的消息也需清理
          if (!m.streaming && !m.thinkingStreaming) return m;
          const finalizedToolCalls = m.toolCalls?.map((tc) =>
            tc.status === 'done' ? tc : { ...tc, status: 'done' as const },
          );
          return { ...m, streaming: false, thinkingStreaming: false, toolCalls: finalizedToolCalls };
        }),
      },
    })),

  // --- Actions: 输入 / 工作目录 ---
  setInput: (input) => set({ input }),
  setWorkingDirectory: (workingDirectory) => {
    void idbSet('moss-working-directory', workingDirectory);
    set({ workingDirectory });
  },
  addRecentDirectory: (dir) =>
    set((state) => {
      const trimmed = dir.trim();
      if (!trimmed) return state;
      const rest = state.recentDirectories.filter((d) => d !== trimmed);
      const next = [trimmed, ...rest].slice(0, 5);
      void idbSet('moss-recent-directories', next);
      return { recentDirectories: next };
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
  // 活跃置顶（乐观更新）：移到该分组第一个任务之前（tasks 为跨分组扁平数组，Sidebar 按组保序渲染）
  touchTask: (id) =>
    set((state) => {
      const task = state.tasks.find((t) => t.id === id);
      if (!task) return state;
      const rest = state.tasks.filter((t) => t.id !== id);
      const firstInGroup = rest.findIndex((t) => t.groupId === task.groupId);
      const insertIdx = firstInGroup === -1 ? rest.length : firstInGroup;
      const next = [...rest];
      next.splice(insertIdx, 0, { ...task, updatedAt: new Date().toISOString() });
      return { tasks: next };
    }),
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

  // --- Actions: Skills / Specs ---
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

  // --- Actions: Skill 模式 ---
  setActiveSkill: (sessionId, skill) =>
    set((state) => ({
      activeSkillBySession: { ...state.activeSkillBySession, [sessionId]: skill },
    })),

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

  // --- Actions: 消息撤回备份 ---
  setTruncateBackup: (sessionId, backup) =>
    set((state) => ({
      truncateBackups: { ...state.truncateBackups, [sessionId]: backup },
    })),

  // --- Actions: PendingConfirm ---
  addPendingConfirm: (confirm) =>
    set((state) => ({
      pendingConfirms: [
        ...state.pendingConfirms.filter((c) => c.toolCallId !== confirm.toolCallId),
        confirm,
      ],
    })),
  removePendingConfirm: (toolCallId) =>
    set((state) => ({
      pendingConfirms: state.pendingConfirms.filter((c) => c.toolCallId !== toolCallId),
    })),
  clearPendingConfirmsBySession: (sessionId) =>
    set((state) => ({
      pendingConfirms: state.pendingConfirms.filter((c) => c.sessionId !== sessionId),
    })),

  // --- Actions: WS ---
  setWsStatus: (wsStatus) => set({ wsStatus }),

  // --- Actions: 发送快捷键 ---
  setSendShortcut: (sendShortcut) => {
    void idbSet('moss-send-shortcut', sendShortcut);
    set({ sendShortcut });
  },

  // --- Actions: 执行权限模式 ---
  setPermissionMode: (permissionMode) => {
    void idbSet('moss-permission-mode', permissionMode);
    set({ permissionMode });
  },

  // --- Actions: 模型添加弹窗信号 ---
  requestModelDialog: () => set({ modelDialogRequest: true }),
  clearModelDialogRequest: () => set({ modelDialogRequest: false }),

  // --- Actions: 右侧边栏标签页 ---
  addSidebarTab: (type, title, toolCallId) => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tab: SidebarTab = { id, type, title, toolCallId, createdAt: Date.now() };
    set((state) => {
      const tabs = [...state.sidebarTabs, tab];
      void idbSet('moss-sidebar-tabs', tabs);
      void idbSet('moss-active-sidebar-tab', id);
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
        tabs = [defaultSidebarTab()];
        activeId = 'default-summary';
      } else if (activeId === id) {
        // 删的是活跃标签 → 切到最后一个
        activeId = tabs[tabs.length - 1].id;
      }
      void idbSet('moss-sidebar-tabs', tabs);
      void idbSet('moss-active-sidebar-tab', activeId ?? '');
      return { sidebarTabs: tabs, activeSidebarTabId: activeId };
    }),

  setActiveSidebarTab: (id) => {
    void idbSet('moss-active-sidebar-tab', id);
    set({ activeSidebarTabId: id });
  },

  renameSidebarTab: (id, title) =>
    set((state) => {
      const tabs = state.sidebarTabs.map((t) =>
        t.id === id ? { ...t, title } : t,
      );
      void idbSet('moss-sidebar-tabs', tabs);
      return { sidebarTabs: tabs };
    }),

  reorderSidebarTabs: (fromId, toId) =>
    set((state) => {
      const from = state.sidebarTabs.findIndex((t) => t.id === fromId);
      const to = state.sidebarTabs.findIndex((t) => t.id === toId);
      if (from < 0 || to < 0 || from === to) return state;
      const tabs = [...state.sidebarTabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      void idbSet('moss-sidebar-tabs', tabs);
      return { sidebarTabs: tabs };
    }),

  // --- Actions: 持久化状态注入 ---
  hydratePersisted: (patch) =>
    set((state) => {
      const next: Partial<UIState> = {};
      if (typeof patch.workingDirectory === 'string' && patch.workingDirectory.length > 0) {
        next.workingDirectory = patch.workingDirectory;
      }
      if (Array.isArray(patch.recentDirectories)) {
        const dirs = patch.recentDirectories.filter(
          (d): d is string => typeof d === 'string',
        );
        next.recentDirectories = dirs.slice(0, 5);
      }
      if (patch.sendShortcut === 'enter' || patch.sendShortcut === 'ctrl-enter') {
        next.sendShortcut = patch.sendShortcut;
      }
      if (
        patch.permissionMode === 'ask' ||
        patch.permissionMode === 'auto' ||
        patch.permissionMode === 'skip'
      ) {
        next.permissionMode = patch.permissionMode;
      }
      if (Array.isArray(patch.sidebarTabs) && patch.sidebarTabs.length > 0) {
        next.sidebarTabs = patch.sidebarTabs;
      }
      if (typeof patch.activeSidebarTabId === 'string' && patch.activeSidebarTabId.length > 0) {
        next.activeSidebarTabId = patch.activeSidebarTabId;
      }
      return next;
    }),
}));
