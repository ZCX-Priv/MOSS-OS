// src/plugins/agent/session.ts
// 会话状态、历史、上下文裁剪。

import type { AgentMessage } from '../contracts';
import type { UnifiedMessage } from '../llm/types';
import type { Logger } from '../../core/types';

/** 上下文文件轨迹（与前端 ContextFile 对齐） */
export interface ContextFile {
  path: string;
  tokens?: number;
  reason?: 'read' | 'edit' | 'write' | 'grep' | 'glob';
}

export interface Session {
  id: string;
  /** 系统提示词（独立存储，不混入对话历史） */
  systemPrompt: string;
  /** 对话历史（不含系统提示，仅 user/assistant/tool） */
  messages: AgentMessage[];
  /** 创建时间 */
  createdAt: string;
  /** 最后活跃时间 */
  updatedAt: string;
  /** 累计 token 用量（估算） */
  totalTokens: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly logger: Logger;
  /** 按 sessionId 索引的上下文文件轨迹（read/edit/write/grep/glob 工具累积） */
  private readonly contextFiles = new Map<string, ContextFile[]>();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /** 获取或创建会话 */
  getOrCreate(sessionId: string, systemPrompt: string): Session {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        systemPrompt,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalTokens: 0,
      };
      this.sessions.set(sessionId, session);
      this.logger.debug(`Session created: ${sessionId}`);
    }
    return session;
  }

  get(sessionId: string): Session | null {
    return this.sessions.get(sessionId) ?? null;
  }

  list(): Session[] {
    return Array.from(this.sessions.values()).map(s => ({
      ...s,
      messages: s.messages, // 直接返回，简化
    }));
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.contextFiles.delete(sessionId);
  }

  // ========================================================================
  // 上下文文件轨迹（供 WS context-updated 推送使用）
  // ========================================================================

  /** 追加/更新上下文文件轨迹（同 path 存在则更新 reason） */
  addContextFile(sessionId: string, file: ContextFile): void {
    const list = this.contextFiles.get(sessionId) ?? [];
    const existing = list.find((f) => f.path === file.path);
    if (existing) {
      existing.reason = file.reason;
    } else {
      list.push({ ...file });
    }
    this.contextFiles.set(sessionId, list);
  }

  /** 获取某 session 的上下文文件列表 */
  getContextFiles(sessionId: string): ContextFile[] {
    return [...(this.contextFiles.get(sessionId) ?? [])];
  }

  /** 估算某 session 上下文文件的累计 token 数（粗略：path 长度 / 2） */
  estimateContextTokens(sessionId: string): number {
    const files = this.contextFiles.get(sessionId) ?? [];
    return files.reduce((sum, f) => sum + Math.ceil((f.path.length + (f.tokens ?? 0)) / 2), 0);
  }

  /** 添加用户消息 */
  addUserMessage(session: Session, content: string): void {
    session.messages.push({ role: 'user', content });
    session.updatedAt = new Date().toISOString();
  }

  /** 添加 assistant 消息（含可能的 tool_calls） */
  addAssistantMessage(
    session: Session,
    content: string,
    toolCalls?: AgentMessage['toolCalls'],
    thinking?: string,
  ): void {
    session.messages.push({
      role: 'assistant',
      content,
      toolCalls,
      thinking,
    });
    session.updatedAt = new Date().toISOString();
  }

  /** 添加工具结果消息 */
  addToolMessage(session: Session, toolCallId: string, content: string, name?: string): void {
    session.messages.push({
      role: 'tool',
      content,
      toolCallId,
      name,
    });
    session.updatedAt = new Date().toISOString();
  }

  /**
   * 上下文窗口裁剪：超限时保留系统提示 + 最近 N 轮。
   * @param maxTokens 最大 token 数（粗略估算：1 char ≈ 0.5 token）
   */
  trimContext(session: Session, maxTokens: number): void {
    // 粗略估算：char 数 / 2 ≈ token 数
    const estimateTokens = (text: string): number => Math.ceil(text.length / 2);

    // 系统提示词单独计算（不混入 messages）
    const systemTokens = estimateTokens(session.systemPrompt);

    let totalTokens = systemTokens;
    for (const m of session.messages) {
      totalTokens += estimateTokens(m.content);
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          totalTokens += estimateTokens(tc.arguments);
        }
      }
    }

    if (totalTokens <= maxTokens) {
      session.totalTokens = totalTokens;
      return;
    }

    // 裁剪：保留 systemPrompt + 最后 N 条对话消息
    const rest = session.messages;

    // 从后往前保留，直到不超过预算（系统提示预留）
    const budget = maxTokens - systemTokens - 500; // 留 500 token 余量
    const kept: AgentMessage[] = [];
    let used = 0;
    for (let i = rest.length - 1; i >= 0; i--) {
      const m = rest[i];
      const t = estimateTokens(m.content) + (m.toolCalls?.reduce((s, tc) => s + estimateTokens(tc.arguments), 0) ?? 0);
      if (used + t > budget) break;
      kept.unshift(m);
      used += t;
    }

    // 注意：裁剪时不能切断 tool_calls 和 tool 结果的配对
    // 1. 丢弃开头孤立的 tool 结果（对应的 assistant 不在 kept 中，无法形成完整配对）
    while (kept.length > 0 && kept[0].role === 'tool') {
      kept.shift();
    }

    // 2. 从后往前扫描，确保每个带 tool_calls 的 assistant 后面紧跟所有对应的 tool 结果
    //    若有缺失，丢弃该 assistant 及其紧随的 tool 结果（整组丢弃）
    for (let i = kept.length - 1; i >= 0; i--) {
      const m = kept[i];
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        const expectedIds = new Set(m.toolCalls.map(tc => tc.id));
        // 收集紧随其后的连续 tool 消息
        let j = i + 1;
        while (j < kept.length && kept[j].role === 'tool') {
          j++;
        }
        // kept[i+1..j-1] 是连续的 tool 结果
        const foundIds = new Set(
          kept.slice(i + 1, j).map(t => t.toolCallId),
        );
        const allCovered = [...expectedIds].every(id => foundIds.has(id));
        if (!allCovered) {
          // 不完整，丢弃整组：assistant(i) + tool 结果(i+1..j-1)
          kept.splice(i, j - i);
        }
      }
    }

    session.messages = kept;
    session.totalTokens = systemTokens + used;
    this.logger.debug(`Context trimmed: ${session.messages.length} messages, ~${session.totalTokens} tokens`);
  }

  /** 把 AgentMessage 转为 LLM UnifiedMessage（头部拼接系统提示词） */
  toUnifiedMessages(session: Session): UnifiedMessage[] {
    const conversation = session.messages.map(m => ({
      role: m.role,
      content: m.content,
      toolCallId: m.toolCallId,
      toolCalls: m.toolCalls?.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
      name: m.name,
    }));
    return [{ role: 'system', content: session.systemPrompt }, ...conversation];
  }
}
