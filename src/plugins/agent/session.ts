// src/plugins/agent/session.ts
// 会话状态、历史、上下文裁剪。

import type { AgentMessage } from '../contracts';
import type { UnifiedMessage } from '../llm/types';
import type { Logger } from '../../core/types';

export interface Session {
  id: string;
  /** 完整的对话历史（含系统提示） */
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

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /** 获取或创建会话 */
  getOrCreate(sessionId: string, systemPrompt: string): Session {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        messages: [{ role: 'system', content: systemPrompt }],
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

    let totalTokens = 0;
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

    // 裁剪：保留 system（第一条）+ 最后 N 条
    const system = session.messages[0];
    const rest = session.messages.slice(1);

    // 从后往前保留，直到不超过预算（系统提示预留）
    const systemTokens = estimateTokens(system.content);
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
    // 若第一条保留的是 tool 结果但没有对应的 assistant tool_calls，向前补
    if (kept.length > 0 && kept[0].role === 'tool') {
      const firstToolCallId = kept[0].toolCallId;
      // 找到对应的 assistant 消息
      let foundIdx = -1;
      for (let i = rest.length - kept.length - 1; i >= 0; i--) {
        if (rest[i].role === 'assistant' && rest[i].toolCalls?.some(tc => tc.id === firstToolCallId)) {
          foundIdx = i;
          break;
        }
      }
      if (foundIdx >= 0) {
        kept.unshift(rest[foundIdx]);
      } else {
        // 找不到配对，丢弃孤立的 tool 结果
        while (kept.length > 0 && kept[0].role === 'tool') {
          kept.shift();
        }
      }
    }

    session.messages = [system, ...kept];
    session.totalTokens = systemTokens + used;
    this.logger.debug(`Context trimmed: ${session.messages.length} messages, ~${session.totalTokens} tokens`);
  }

  /** 把 AgentMessage 转为 LLM UnifiedMessage */
  toUnifiedMessages(session: Session): UnifiedMessage[] {
    return session.messages.map(m => ({
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
  }
}
