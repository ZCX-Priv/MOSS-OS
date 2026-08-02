// frontend/src/store/index.ts
// 全局状态：Zustand

import { create } from 'zustand';
import type { AppConfig, ApiConfig, ChatMessage, PendingAsk, Session, McpServer, McpTool } from '../types';

interface UIState {
  // 当前活跃会话
  activeSessionId: string | null;
  // 会话列表
  sessions: Session[];
  // 消息（按 sessionId 索引）
  messagesBySession: Record<string, ChatMessage[]>;
  // 当前输入
  input: string;
  // 是否正在生成
  isGenerating: boolean;
  // 当前选中的 model
  selectedModel: string;
  // 当前选中的 provider
  selectedProvider: string | null;
  // 工作目录
  workingDirectory: string;
  // 配置
  appConfig: AppConfig | null;
  apiConfig: ApiConfig | null;
  // MCP
  mcpServers: McpServer[];
  mcpTools: McpTool[];
  // 工具发起的、等待用户回复的提问列表
  pendingAsks: PendingAsk[];
  // WS 状态
  wsStatus: 'connecting' | 'open' | 'closed' | 'error';
  // UI 面板
  activePanel: 'chat' | 'config' | 'api-config' | 'mcp' | 'sessions';
}

interface UIActions {
  setActiveSession: (id: string | null) => void;
  setSessions: (s: Session[]) => void;
  addSession: (s: Session) => void;
  removeSession: (id: string) => void;
  setMessages: (sessionId: string, messages: ChatMessage[]) => void;
  addMessage: (sessionId: string, message: ChatMessage) => void;
  updateMessage: (sessionId: string, messageId: string, patch: Partial<ChatMessage>) => void;
  appendToMessage: (sessionId: string, messageId: string, field: 'content' | 'thinking', text: string) => void;
  clearMessages: (sessionId: string) => void;
  setInput: (input: string) => void;
  setIsGenerating: (v: boolean) => void;
  setSelectedModel: (m: string) => void;
  setSelectedProvider: (p: string | null) => void;
  setWorkingDirectory: (cwd: string) => void;
  setAppConfig: (c: AppConfig | null) => void;
  setApiConfig: (c: ApiConfig | null) => void;
  setMcpServers: (s: McpServer[]) => void;
  setMcpTools: (t: McpTool[]) => void;
  addPendingAsk: (ask: PendingAsk) => void;
  removePendingAsk: (toolCallId: string) => void;
  clearPendingAsks: () => void;
  setWsStatus: (s: UIState['wsStatus']) => void;
  setActivePanel: (p: UIState['activePanel']) => void;
}

export type Store = UIState & UIActions;

export const useStore = create<Store>((set) => ({
  activeSessionId: null,
  sessions: [],
  messagesBySession: {},
  input: '',
  isGenerating: false,
  selectedModel: '',
  selectedProvider: null,
  workingDirectory: '',
  appConfig: null,
  apiConfig: null,
  mcpServers: [],
  mcpTools: [],
  pendingAsks: [],
  wsStatus: 'closed',
  activePanel: 'chat',

  setActiveSession: (id) => set({ activeSessionId: id }),
  setSessions: (sessions) => set({ sessions }),
  addSession: (s) => set((state) => ({ sessions: [...state.sessions, s] })),
  removeSession: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.messagesBySession;
      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        messagesBySession: rest,
        activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
      };
    }),
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
          m.id === messageId
            ? { ...m, [field]: (m[field] ?? '') + text }
            : m,
        ),
      },
    })),
  clearMessages: (sessionId) =>
    set((state) => ({
      messagesBySession: { ...state.messagesBySession, [sessionId]: [] },
    })),
  setInput: (input) => set({ input }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setSelectedProvider: (selectedProvider) => set({ selectedProvider }),
  setWorkingDirectory: (workingDirectory) => set({ workingDirectory }),
  setAppConfig: (appConfig) => set({ appConfig }),
  setApiConfig: (apiConfig) => set({ apiConfig }),
  setMcpServers: (mcpServers) => set({ mcpServers }),
  setMcpTools: (mcpTools) => set({ mcpTools }),
  addPendingAsk: (ask) =>
    set((state) => ({
      pendingAsks: [...state.pendingAsks.filter((a) => a.toolCallId !== ask.toolCallId), ask],
    })),
  removePendingAsk: (toolCallId) =>
    set((state) => ({
      pendingAsks: state.pendingAsks.filter((a) => a.toolCallId !== toolCallId),
    })),
  clearPendingAsks: () => set({ pendingAsks: [] }),
  setWsStatus: (wsStatus) => set({ wsStatus }),
  setActivePanel: (activePanel) => set({ activePanel }),
}));
