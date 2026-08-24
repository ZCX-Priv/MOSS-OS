// UI/src/store/index.ts
// 全局状态：Zustand。迁移自 webui/src/store/index.ts 并扩展新切片。
// 切片：会话/消息/输入/生成态/模型/Agent/任务/任务分组/Todo/Context/
//       自动化/插件/Skills/Specs/MCP/配置/WS/面板。

import { create } from 'zustand';
import { idbSet } from '../utils/idb';
import { normalizeShortcut } from '../utils/shortcut';
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
  ProviderItem,
  AgentItem,
  AutomationItem,
  AutomationRun,
  SkillItem,
  SpecItem,
  ToolItem,
  CommandItem,
  SidebarTab,
  SidebarTabType,
  PermissionMode,
  RunStats,
  ContextStats,
} from '../types/api';
import { DEFAULT_RENDER_SETTINGS, isValidRenderSettings, type RenderSettings } from '../render/core/types';
import { DEFAULT_ANIMATION_SETTINGS, isValidAnimationSettings, type AnimationSettings } from '../types/animation';

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
  /** 最近一轮运行是否出错（按 sessionId 索引；缺省视为 false，新流开始自动清除） */
  errorBySession: Record<string, boolean>;
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

  // --- 服务商（模型挂在服务商下；currentModel 为模型 id） ---
  providers: ProviderItem[];
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
  /** 上下文引擎统计（token 构成/缓存命中/压缩状态/系统分段；context-stats-updated 事件维护） */
  contextStatsBySession: Record<string, ContextStats | undefined>;
  /** LLM 文件读取信号（每次 WS context-updated，即真实 read/grep/glob 调用，递增；历史恢复不触发） */
  contextFileReadSeqBySession: Record<string, number>;

  // --- 自动化 ---
  automations: AutomationItem[];
  automationHistory: Record<string, AutomationRun[]>;
  /** 新建/编辑自动化任务表单：是否打开 */
  automationFormOpen: boolean;
  /** 编辑模式的任务 id（null = 新建） */
  automationFormEditingId: string | null;
  /** 表单打开序号（每次 open 递增；作为 Dialog key 强制重挂载，保证表单状态独立不继承上次输入） */
  automationFormSeq: number;

  // --- Skills / Specs / Commands ---
  skills: SkillItem[];
  specs: SpecItem[];
  /** 自定义斜杠命令（~/.moss/commands/<name>.md；/ 菜单与设置页数据源） */
  commands: CommandItem[];

  // --- 工具（完整列表，含 enabled/source，供工具管理 UI） ---
  tools: ToolItem[];

  // --- 配置 ---
  appConfig: AppConfig | null;
  apiConfig: ApiConfig | null;

  // --- MCP ---
  mcpServers: McpServer[];
  mcpTools: McpTool[];

  // --- 运行统计（会话级；stats-updated 事件维护，run 级口径每次发送重置） ---
  runStatsBySession: Record<string, RunStats | undefined>;

  // --- 中控岛展开状态（会话级；默认折叠，undefined 视为折叠） ---
  hubActiveModuleBySession: Record<string, string | null | undefined>;

  // --- 工具图标映射（toolName → icon 字符串，由 /api/tools 拉取） ---
  toolIconMap: Record<string, string>;

  // --- WS ---
  wsStatus: 'connecting' | 'open' | 'closed' | 'error';

  // --- 发送快捷键（归一化格式：'enter' / 'mod+enter' / 任意自定义组合） ---
  sendShortcut: string;

  // --- 跟进行为（任务进行中发送消息时的处理方式） ---
  followUpBehavior: 'queue' | 'guide';
  /** 排队消息队列（sessionId → 待发送消息列表） */
  messageQueueBySession: Record<string, Array<{ id: string; content: string; timestamp: string }>>;

  // --- 外观设置（IndexedDB 持久化） ---
  /** 主题色（预设 ID 或自定义 oklch/hex 字符串） */
  accentColor: string;
  /** 字号 */
  fontSize: 'small' | 'medium' | 'large';
  /** 界面密度 */
  uiDensity: 'compact' | 'standard' | 'comfortable';
  /** 圆角大小 */
  cornerRadius: 'small' | 'standard' | 'large';
  /** 侧边栏样式 */
  sidebarStyle: 'narrow' | 'standard' | 'wide';

  // --- 执行权限模式（permissionMode=全局默认；permissionModeBySession=会话级覆盖） ---
  permissionMode: PermissionMode;
  /** 会话级权限模式覆盖（sessionId → mode；sendMessage 取当前会话值，缺省回退全局） */
  permissionModeBySession: Record<string, PermissionMode | undefined>;

  // --- 右侧边栏标签页（全局，IndexedDB 持久化） ---
  sidebarTabs: SidebarTab[];
  activeSidebarTabId: string | null;
  /** 右侧面板展开态（会话级内存态：各会话独立互不影响，重挂载不重置；'' key = 空白页） */
  rightPanelOpenBySession: Record<string, boolean | undefined>;
  /** 右侧面板宽度 px（全局内存态；UI 偏好跨会话共享，拖拽调宽后重挂载不重置） */
  rightPanelWidth: number;

  // --- 渲染设置（render 模块，IndexedDB 持久化） ---
  renderSettings: RenderSettings;
  /** 动画设置（总开关+分开关；IndexedDB 持久化） */
  animationSettings: AnimationSettings;
  /** 系统是否开启"减弱动态效果"（matchMedia 实时监听；true 时强制停用全部动画） */
  prefersReducedMotion: boolean;
}

/** 从 IndexedDB 预填充后写入 store 的持久化状态（各字段可选，值非法时忽略） */
export interface PersistedState {
  workingDirectory?: string;
  recentDirectories?: string[];
  sendShortcut?: string;
  followUpBehavior?: 'queue' | 'guide';
  accentColor?: string;
  fontSize?: 'small' | 'medium' | 'large';
  uiDensity?: 'compact' | 'standard' | 'comfortable';
  cornerRadius?: 'small' | 'standard' | 'large';
  sidebarStyle?: 'narrow' | 'standard' | 'wide';
  permissionMode?: PermissionMode;
  sidebarTabs?: SidebarTab[];
  activeSidebarTabId?: string;
  renderSettings?: RenderSettings;
  animationSettings?: AnimationSettings;
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
  /** 标记/清除 session 的错误态（新流开始时由 setGenerating 自动清除） */
  setTaskError: (sessionId: string, v: boolean) => void;
  /** 将指定 session 中所有 streaming 的消息标记为已完成 */
  finalizeStreamingMessages: (sessionId: string) => void;

  // 输入 / 工作目录
  setInput: (input: string) => void;
  setWorkingDirectory: (cwd: string) => void;
  addRecentDirectory: (dir: string) => void;

  // 服务商
  setProviders: (providers: ProviderItem[]) => void;
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
  /** 更新会话上下文引擎统计（stats API / context-stats-updated 事件） */
  setContextStats: (sessionId: string, stats: ContextStats) => void;
  /** 递增会话的 LLM 文件读取信号（仅 WS context-updated 真实读取时调用） */
  bumpContextFileReadSeq: (sessionId: string) => void;

  // 自动化
  setAutomations: (a: AutomationItem[]) => void;
  addAutomation: (a: AutomationItem) => void;
  updateAutomation: (id: string, patch: Partial<AutomationItem>) => void;
  removeAutomation: (id: string) => void;
  setAutomationHistory: (id: string, history: AutomationRun[]) => void;
  addAutomationRun: (id: string, run: AutomationRun) => void;
  updateAutomationRun: (id: string, runId: string, patch: Partial<AutomationRun>) => void;
  openAutomationForm: (editingId?: string) => void;
  closeAutomationForm: () => void;

  // Skills / Specs / Commands
  setSkills: (s: SkillItem[]) => void;
  setSpecs: (s: SpecItem[]) => void;
  setCommands: (c: CommandItem[]) => void;

  // 工具
  setTools: (t: ToolItem[]) => void;
  updateTool: (name: string, patch: Partial<ToolItem>) => void;

  // 配置
  setAppConfig: (c: AppConfig | null) => void;
  setApiConfig: (c: ApiConfig | null) => void;

  // MCP
  setMcpServers: (s: McpServer[]) => void;
  setMcpTools: (t: McpTool[]) => void;

  // 运行统计（stats-updated 事件；sendMessage 时清空旧 run 数据）
  setRunStats: (sessionId: string, stats: RunStats | undefined) => void;

  // 中控岛展开模块（null=折叠；moduleId=展开并激活）
  setHubActiveModule: (sessionId: string, moduleId: string | null) => void;

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

  // 跟进行为
  setFollowUpBehavior: (v: UIState['followUpBehavior']) => void;
  addToMessageQueue: (sessionId: string, message: { id: string; content: string; timestamp: string }) => void;
  removeFromMessageQueue: (sessionId: string, messageId: string) => void;
  clearMessageQueue: (sessionId: string) => void;

  // 外观设置
  setAccentColor: (v: string) => void;
  setFontSize: (v: UIState['fontSize']) => void;
  setUiDensity: (v: UIState['uiDensity']) => void;
  setCornerRadius: (v: UIState['cornerRadius']) => void;
  setSidebarStyle: (v: UIState['sidebarStyle']) => void;

  // 执行权限模式
  setPermissionMode: (v: UIState['permissionMode'], sessionId?: string) => void;

  // 渲染设置（render 模块）
  setRenderSetting: <K extends keyof RenderSettings>(key: K, value: RenderSettings[K]) => void;

  // 动画设置（总开关+分开关；IndexedDB 持久化）与系统减弱动态偏好
  setAnimationSetting: <K extends keyof AnimationSettings>(key: K, value: AnimationSettings[K]) => void;
  setPrefersReducedMotion: (v: boolean) => void;

  // 模型菜单"添加服务商"跳转设置页并打开弹窗的信号
  providerDialogRequest: boolean;
  requestProviderDialog: () => void;
  clearProviderDialogRequest: () => void;

  // 移动端服务商页 header 搜索按钮：切换搜索框显隐（seq 计数，避免连续点击不触发）
  providerSearchSeq: number;
  toggleProviderSearch: () => void;

  // 插件库 MCP tab：页面头部/移动端全局 header"添加服务器"按钮 → McpTab 打开弹窗的信号
  mcpDialogRequest: boolean;
  requestMcpDialog: () => void;
  clearMcpDialogRequest: () => void;

  // 插件库 MCP tab：移动端全局 header 刷新按钮（seq 计数，避免连续点击不触发）
  mcpRefreshSeq: number;
  requestMcpRefresh: () => void;

  // 插件库技能 tab：页面头部/移动端全局 header"添加技能"按钮 → 技能弹窗打开信号
  skillsDialogRequest: boolean;
  requestSkillsDialog: () => void;
  clearSkillsDialogRequest: () => void;

  // 插件库技能 tab：移动端全局 header 刷新按钮（seq 计数）
  skillsRefreshSeq: number;
  requestSkillsRefresh: () => void;

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

  // 右侧面板展开态（会话级）/ 宽度（全局），内存态不持久化
  setRightPanelOpen: (sessionId: string, v: boolean) => void;
  setRightPanelWidth: (v: number) => void;
  /** 面板开合状态随对话转移：空白页（''）发送首条消息创建新会话时继承，避免导航重挂载后收起 */
  migrateRightPanelState: (fromSessionId: string, toSessionId: string) => void;

  // 持久化状态注入（main.tsx 预填充 IndexedDB 后、渲染前调用）
  hydratePersisted: (patch: PersistedState) => void;
}

export type Store = UIState & UIActions;

// ============================================================================
// 工作目录：默认路径 + IndexedDB 持久化
// ============================================================================

/** 系统级（本机）工作目录哨兵：全盘访问（filesys roots 放行，shell 默认目录为主目录） */
export const SYSTEM_WORKING_DIRECTORY = '__system__';

/** 默认工作目录：本机 System 模式 */
export const DEFAULT_WORKING_DIRECTORY = SYSTEM_WORKING_DIRECTORY;

/** 旧版默认工作目录（C 盘根）：IndexedDB 存量值迁移用 */
export const LEGACY_DEFAULT_WORKING_DIRECTORY = 'C:\\';

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
  errorBySession: {},
  pendingAsks: [],
  pendingConfirms: [],
  truncateBackups: {},

  // --- 输入 / 工作目录 ---
  input: '',
  workingDirectory: DEFAULT_WORKING_DIRECTORY,
  recentDirectories: [],

  // --- 服务商 ---
  providers: [],
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
  contextStatsBySession: {},
  contextFileReadSeqBySession: {},

  // --- 自动化 ---
  automations: [],
  automationHistory: {},
  automationFormOpen: false,
  automationFormEditingId: null,
  automationFormSeq: 0,

  // --- Skills / Specs / Commands ---
  skills: [],
  specs: [],
  commands: [],

  // --- 工具 ---
  tools: [],

  // --- 配置 ---
  appConfig: null,
  apiConfig: null,

  // --- MCP ---
  mcpServers: [],
  mcpTools: [],
  runStatsBySession: {},
  hubActiveModuleBySession: {},

  // --- 工具图标映射 ---
  toolIconMap: {},

  // --- WS ---
  wsStatus: 'closed',

  // --- 发送快捷键 ---
  sendShortcut: 'mod+enter',

  // --- 跟进行为 ---
  followUpBehavior: 'queue',
  messageQueueBySession: {},

  // --- 外观设置 ---
  accentColor: 'blue',
  fontSize: 'medium',
  uiDensity: 'standard',
  cornerRadius: 'standard',
  sidebarStyle: 'standard',

  // --- 执行权限模式 ---
  permissionMode: 'ask',
  permissionModeBySession: {},

  // --- 渲染设置（render 模块，IndexedDB 持久化） ---
  renderSettings: DEFAULT_RENDER_SETTINGS,
  animationSettings: DEFAULT_ANIMATION_SETTINGS,
  prefersReducedMotion: false,

  // 模型菜单"添加服务商"跳转设置页并打开弹窗的信号
  providerDialogRequest: false,
  providerSearchSeq: 0,

  // 插件库 MCP tab：header 按钮信号
  mcpDialogRequest: false,
  mcpRefreshSeq: 0,

  // 插件库技能 tab：header 按钮信号
  skillsDialogRequest: false,
  skillsRefreshSeq: 0,

  // --- 右侧边栏标签页（IndexedDB 持久化） ---
  sidebarTabs: [defaultSidebarTab()],
  activeSidebarTabId: 'default-summary',

  // --- 右侧面板展开态/宽度（内存态；默认收起 320px） ---
  rightPanelOpenBySession: {},
  rightPanelWidth: 320,

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
      const { [id]: _omitReadSeq, ...restReadSeq } = state.contextFileReadSeqBySession;
      const { [id]: _omitPerm, ...restPermModes } = state.permissionModeBySession;
      const { [id]: _omitBackup, ...restBackups } = state.truncateBackups;
      const { [id]: _omitStats, ...restStats } = state.runStatsBySession;
      const { [id]: _omitHub, ...restHub } = state.hubActiveModuleBySession;
      const { [id]: _omitPanel, ...restPanel } = state.rightPanelOpenBySession;
      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        messagesBySession: restMessages,
        generatingBySession: restGen,
        todosBySession: restTodos,
        contextBySession: restCtx,
        contextFileReadSeqBySession: restReadSeq,
        permissionModeBySession: restPermModes,
        truncateBackups: restBackups,
        runStatsBySession: restStats,
        hubActiveModuleBySession: restHub,
        rightPanelOpenBySession: restPanel,
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
      // 新流开始自动清除上一轮错误态（发送消息 = 用户已看到错误并重试）
      ...(v ? { errorBySession: { ...state.errorBySession, [sessionId]: false } } : {}),
    })),
  setTaskError: (sessionId, v) =>
    set((state) => ({
      errorBySession: { ...state.errorBySession, [sessionId]: v },
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

  // --- Actions: 服务商 ---
  setProviders: (providers) => set({ providers }),
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
    set((state) => {
      const task = state.tasks.find((t) => t.id === id);
      if (!task) return {};
      const merged = { ...task, ...patch };
      const rest = state.tasks.filter((t) => t.id !== id);
      // 该任务所在组按 order 局部重排（与后端 listTasks 排序一致）：
      // 跨组移动（后端 order 置顶）后"移入顶部"即时可见，不必等重新拉取列表
      const groupTasks = rest
        .filter((t) => t.groupId === merged.groupId)
        .concat(merged)
        .sort((a, b) => {
          const oa = a.order ?? Number.MAX_SAFE_INTEGER;
          const ob = b.order ?? Number.MAX_SAFE_INTEGER;
          if (oa !== ob) return oa - ob;
          return b.createdAt.localeCompare(a.createdAt);
        });
      const others = rest.filter((t) => t.groupId !== merged.groupId);
      return { tasks: [...others, ...groupTasks] };
    }),
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
  setContextStats: (sessionId, stats) =>
    set((state) => ({
      contextStatsBySession: { ...state.contextStatsBySession, [sessionId]: stats },
    })),
  bumpContextFileReadSeq: (sessionId) =>
    set((state) => ({
      contextFileReadSeqBySession: {
        ...state.contextFileReadSeqBySession,
        [sessionId]: (state.contextFileReadSeqBySession[sessionId] ?? 0) + 1,
      },
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
  openAutomationForm: (editingId) =>
    set((state) => ({
      automationFormOpen: true,
      automationFormEditingId: editingId ?? null,
      automationFormSeq: state.automationFormSeq + 1,
    })),
  closeAutomationForm: () => set({ automationFormOpen: false, automationFormEditingId: null }),

  // --- Actions: Skills / Specs / Commands ---
  setSkills: (skills) => set({ skills }),
  setSpecs: (specs) => set({ specs }),
  setCommands: (commands) => set({ commands }),

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

  // --- Actions: 运行统计 ---
  setRunStats: (sessionId, stats) =>
    set((state) => ({
      runStatsBySession: { ...state.runStatsBySession, [sessionId]: stats },
    })),

  // --- Actions: 中控岛 ---
  setHubActiveModule: (sessionId, moduleId) =>
    set((state) => ({
      hubActiveModuleBySession: { ...state.hubActiveModuleBySession, [sessionId]: moduleId },
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
    const normalized = normalizeShortcut(sendShortcut);
    void idbSet('moss-send-shortcut', normalized);
    set({ sendShortcut: normalized });
  },

  // --- Actions: 跟进行为 ---
  setFollowUpBehavior: (followUpBehavior) => {
    void idbSet('moss-follow-up-behavior', followUpBehavior);
    set({ followUpBehavior });
  },
  addToMessageQueue: (sessionId, message) =>
    set((state) => ({
      messageQueueBySession: {
        ...state.messageQueueBySession,
        [sessionId]: [...(state.messageQueueBySession[sessionId] ?? []), message],
      },
    })),
  removeFromMessageQueue: (sessionId, messageId) =>
    set((state) => {
      const queue = state.messageQueueBySession[sessionId] ?? [];
      return {
        messageQueueBySession: {
          ...state.messageQueueBySession,
          [sessionId]: queue.filter((m) => m.id !== messageId),
        },
      };
    }),
  clearMessageQueue: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...rest } = state.messageQueueBySession;
      return { messageQueueBySession: rest };
    }),

  // --- Actions: 外观设置 ---
  setAccentColor: (accentColor) => {
    void idbSet('moss-accent-color', accentColor);
    set({ accentColor });
  },
  setFontSize: (fontSize) => {
    void idbSet('moss-font-size', fontSize);
    set({ fontSize });
  },
  setUiDensity: (uiDensity) => {
    void idbSet('moss-ui-density', uiDensity);
    set({ uiDensity });
  },
  setCornerRadius: (cornerRadius) => {
    void idbSet('moss-corner-radius', cornerRadius);
    set({ cornerRadius });
  },
  setSidebarStyle: (sidebarStyle) => {
    void idbSet('moss-sidebar-style', sidebarStyle);
    set({ sidebarStyle });
  },

  // --- Actions: 执行权限模式 ---
  setPermissionMode: (permissionMode, sessionId) => {
    if (sessionId) {
      // 会话级覆盖：不写 IndexedDB（后端 session 持久化，刷新经 GET /api/tasks/:id 恢复）
      set((state) => ({ permissionModeBySession: { ...state.permissionModeBySession, [sessionId]: permissionMode } }));
      return;
    }
    // 全局默认：持久化 IndexedDB
    void idbSet('moss-permission-mode', permissionMode);
    set({ permissionMode });
  },

  // --- Actions: 渲染设置（render 模块） ---
  setRenderSetting: (key, value) => {
    set((state) => {
      const renderSettings = { ...state.renderSettings, [key]: value };
      void idbSet('moss-render-settings', renderSettings);
      return { renderSettings };
    });
  },

  setAnimationSetting: (key, value) => {
    set((state) => {
      const animationSettings = { ...state.animationSettings, [key]: value };
      void idbSet('moss-animation-settings', animationSettings);
      return { animationSettings };
    });
  },

  setPrefersReducedMotion: (v) => set({ prefersReducedMotion: v }),

  // --- Actions: 服务商添加弹窗信号 ---
  requestProviderDialog: () => set({ providerDialogRequest: true }),
  clearProviderDialogRequest: () => set({ providerDialogRequest: false }),
  toggleProviderSearch: () =>
    set((state) => ({ providerSearchSeq: state.providerSearchSeq + 1 })),

  // --- Actions: 插件库 MCP tab header 按钮信号 ---
  requestMcpDialog: () => set({ mcpDialogRequest: true }),
  clearMcpDialogRequest: () => set({ mcpDialogRequest: false }),
  requestMcpRefresh: () => set((state) => ({ mcpRefreshSeq: state.mcpRefreshSeq + 1 })),
  requestSkillsDialog: () => set({ skillsDialogRequest: true }),
  clearSkillsDialogRequest: () => set({ skillsDialogRequest: false }),
  requestSkillsRefresh: () => set((state) => ({ skillsRefreshSeq: state.skillsRefreshSeq + 1 })),

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

  // --- Actions: 右侧面板展开态/宽度（内存态，不持久化） ---
  setRightPanelOpen: (sessionId, v) =>
    set((state) => ({
      rightPanelOpenBySession: { ...state.rightPanelOpenBySession, [sessionId]: v },
    })),
  setRightPanelWidth: (v) => set({ rightPanelWidth: v }),
  migrateRightPanelState: (fromSessionId, toSessionId) =>
    set((state) => {
      if (fromSessionId === toSessionId) return state;
      const fromOpen = state.rightPanelOpenBySession[fromSessionId] ?? false;
      const { [fromSessionId]: _omit, ...rest } = state.rightPanelOpenBySession;
      return { rightPanelOpenBySession: { ...rest, [toSessionId]: fromOpen } };
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
      if (typeof patch.sendShortcut === 'string' && patch.sendShortcut.length > 0) {
        next.sendShortcut = patch.sendShortcut;
      }
      if (patch.followUpBehavior === 'queue' || patch.followUpBehavior === 'guide') {
        next.followUpBehavior = patch.followUpBehavior;
      }
      if (typeof patch.accentColor === 'string' && patch.accentColor.length > 0) {
        next.accentColor = patch.accentColor;
      }
      if (patch.fontSize === 'small' || patch.fontSize === 'medium' || patch.fontSize === 'large') {
        next.fontSize = patch.fontSize;
      }
      if (patch.uiDensity === 'compact' || patch.uiDensity === 'standard' || patch.uiDensity === 'comfortable') {
        next.uiDensity = patch.uiDensity;
      }
      if (patch.cornerRadius === 'small' || patch.cornerRadius === 'standard' || patch.cornerRadius === 'large') {
        next.cornerRadius = patch.cornerRadius;
      }
      if (patch.sidebarStyle === 'narrow' || patch.sidebarStyle === 'standard' || patch.sidebarStyle === 'wide') {
        next.sidebarStyle = patch.sidebarStyle;
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
      if (isValidRenderSettings(patch.renderSettings)) {
        next.renderSettings = patch.renderSettings;
      }
      if (isValidAnimationSettings(patch.animationSettings)) {
        next.animationSettings = patch.animationSettings;
      }
      return next;
    }),
}));
