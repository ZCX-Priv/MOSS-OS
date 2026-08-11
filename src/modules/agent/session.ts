// src/plugins/agent/session.ts
// 会话状态、历史、上下文裁剪。
// 持久化：每个 session 存为 ~/.moss/sessions/<sessionId>.json，启动时全量加载到内存。

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentMessage } from '../contracts';
import type { UnifiedMessage } from '../llm/types';
import type { TodoItem } from '../tools/todo';
import type { Environment, Logger } from '../../core/types';

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
  /** 上下文文件轨迹（read/edit/write/grep/glob 工具累积），随 session 持久化 */
  contextFiles: ContextFile[];
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly logger: Logger;
  /** session 持久化目录：~/.moss/sessions */
  private readonly sessionsDir: string;

  constructor(env: Environment, logger: Logger) {
    this.logger = logger;
    this.sessionsDir = join(env.dataDir, 'sessions');
    this.loadAll();
  }

  /** 启动时全量加载所有 session 文件到内存（损坏文件跳过，目录不存在则跳过） */
  private loadAll(): void {
    try {
      if (!existsSync(this.sessionsDir)) return;
      const entries = readdirSync(this.sessionsDir);
      for (const name of entries) {
        if (!name.endsWith('.json')) continue;
        const filePath = join(this.sessionsDir, name);
        try {
          const raw = readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(raw) as Partial<Session>;
          if (
            typeof parsed.id === 'string' &&
            Array.isArray(parsed.messages) &&
            typeof parsed.systemPrompt === 'string'
          ) {
            const session: Session = {
              id: parsed.id,
              systemPrompt: parsed.systemPrompt,
              messages: parsed.messages,
              createdAt: parsed.createdAt ?? new Date().toISOString(),
              updatedAt: parsed.updatedAt ?? new Date().toISOString(),
              totalTokens: parsed.totalTokens ?? 0,
              contextFiles: Array.isArray(parsed.contextFiles) ? parsed.contextFiles : [],
            };
            this.sessions.set(session.id, session);
          }
        } catch (err) {
          this.logger.warn('Failed to load session file, skipping', {
            file: name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      this.logger.debug(`Loaded ${this.sessions.size} sessions from disk`);
    } catch (err) {
      this.logger.warn('Failed to scan sessions directory', {
        dir: this.sessionsDir,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 把单个 session 持久化到磁盘 */
  private saveSession(session: Session): void {
    try {
      mkdirSync(this.sessionsDir, { recursive: true });
      const filePath = join(this.sessionsDir, `${session.id}.json`);
      writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8');
    } catch (err) {
      this.logger.error('Failed to save session', {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 从磁盘加载单个 session（冗余保护：eager load 后通常命中） */
  private loadFromDisk(sessionId: string): Session | null {
    try {
      const filePath = join(this.sessionsDir, `${sessionId}.json`);
      if (!existsSync(filePath)) return null;
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<Session>;
      if (
        typeof parsed.id === 'string' &&
        Array.isArray(parsed.messages) &&
        typeof parsed.systemPrompt === 'string'
      ) {
        const session: Session = {
          id: parsed.id,
          systemPrompt: parsed.systemPrompt,
          messages: parsed.messages,
          createdAt: parsed.createdAt ?? new Date().toISOString(),
          updatedAt: parsed.updatedAt ?? new Date().toISOString(),
          totalTokens: parsed.totalTokens ?? 0,
          contextFiles: Array.isArray(parsed.contextFiles) ? parsed.contextFiles : [],
        };
        this.sessions.set(session.id, session);
        return session;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** 获取或创建会话 */
  getOrCreate(sessionId: string, systemPrompt: string): Session {
    let session: Session | null = this.sessions.get(sessionId) ?? null;
    if (!session) {
      // 冗余保护：尝试从磁盘加载
      session = this.loadFromDisk(sessionId);
    }
    if (!session) {
      session = {
        id: sessionId,
        systemPrompt,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalTokens: 0,
        contextFiles: [],
      };
      this.sessions.set(sessionId, session);
      this.saveSession(session);
      this.logger.debug(`Session created: ${sessionId}`);
    }
    return session;
  }

  get(sessionId: string): Session | null {
    let session = this.sessions.get(sessionId) ?? null;
    if (!session) {
      // 冗余保护：尝试从磁盘加载
      session = this.loadFromDisk(sessionId);
    }
    return session;
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
    try {
      const filePath = join(this.sessionsDir, `${sessionId}.json`);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch (err) {
      this.logger.warn('Failed to delete session file', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ========================================================================
  // 上下文文件轨迹（供 WS context-updated 推送使用）
  // ========================================================================

  /** 追加/更新上下文文件轨迹（同 path 存在则更新 reason） */
  addContextFile(sessionId: string, file: ContextFile): void {
    const session = this.get(sessionId);
    if (!session) return;
    const list = session.contextFiles;
    const existing = list.find((f) => f.path === file.path);
    if (existing) {
      existing.reason = file.reason;
    } else {
      list.push({ ...file });
    }
    this.saveSession(session);
  }

  /** 获取某 session 的上下文文件列表 */
  getContextFiles(sessionId: string): ContextFile[] {
    const session = this.get(sessionId);
    return session ? [...session.contextFiles] : [];
  }

  /** 估算某 session 上下文文件的累计 token 数（粗略：path 长度 / 2） */
  estimateContextTokens(sessionId: string): number {
    const session = this.get(sessionId);
    if (!session) return 0;
    return session.contextFiles.reduce(
      (sum, f) => sum + Math.ceil((f.path.length + (f.tokens ?? 0)) / 2),
      0,
    );
  }

  /** 添加用户消息 */
  addUserMessage(session: Session, content: string): void {
    session.messages.push({ role: 'user', content });
    session.updatedAt = new Date().toISOString();
    this.saveSession(session);
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
    this.saveSession(session);
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
    this.saveSession(session);
  }

  /** 把 todo 快照附加到包含该 toolCallId 的 assistant 消息上（持久化） */
  attachTodoSnapshot(session: Session, toolCallId: string, todos: TodoItem[]): void {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const m = session.messages[i];
      if (m.role === 'assistant' && m.toolCalls?.some((tc) => tc.id === toolCallId)) {
        m.todoSnapshot = todos;
        break;
      }
    }
    session.updatedAt = new Date().toISOString();
    this.saveSession(session);
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
    this.saveSession(session);
  }

  /** 把 AgentMessage 转为 LLM UnifiedMessage（头部拼接系统提示词） */
  toUnifiedMessages(session: Session): UnifiedMessage[] {
    // 发送前自愈：保证 tool_use / tool_result 配对完整，避免历史脏数据触发
    // Anthropic HTTP 400（tool_use without tool_result）。不修改 session.messages。
    const sanitized = sanitizeMessages(session.messages);
    const conversation = sanitized.map(m => ({
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

/**
 * 保证 tool_use / tool_result 配对完整性（发送前自愈）。
 * Anthropic（及 OpenAI/Gemini）要求每个 tool_use 后紧跟对应 tool_use_id 的 tool_result。
 * - 带 toolCalls 的 assistant：紧随其后必须有覆盖全部 toolCallId 的连续 tool 消息；
 *   完整则保留 assistant + 对应 tool 结果（丢弃多余 tool 结果）；
 *   不完整则丢弃 toolCalls（保留 assistant 纯文本，文本为空则整条丢弃），并丢弃这些 tool 结果。
 * - 孤立 tool 消息（前面无配对 assistant）：丢弃。
 * 不修改输入数组，返回新数组。
 */
function sanitizeMessages(msgs: AgentMessage[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  let i = 0;
  while (i < msgs.length) {
    const m = msgs[i];
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const expectedIds = new Set(m.toolCalls.map(tc => tc.id));
      // 收集紧随其后的连续 tool 消息
      const toolResults: AgentMessage[] = [];
      let j = i + 1;
      while (j < msgs.length && msgs[j].role === 'tool') {
        toolResults.push(msgs[j]);
        j++;
      }
      const foundIds = new Set(
        toolResults.map(t => t.toolCallId).filter((id): id is string => typeof id === 'string'),
      );
      const allCovered = [...expectedIds].every(id => foundIds.has(id));
      if (allCovered) {
        out.push(m);
        for (const tr of toolResults) {
          if (tr.toolCallId && expectedIds.has(tr.toolCallId)) out.push(tr);
        }
      } else {
        // 不配对：保留 assistant 纯文本（去掉 toolCalls），丢弃这些 tool 结果
        if (m.content && m.content.trim()) {
          out.push({ ...m, toolCalls: undefined });
        }
      }
      i = j;
      continue;
    }
    if (m.role === 'tool') {
      // 孤立 tool 消息（无前导配对 assistant）：丢弃
      i++;
      continue;
    }
    out.push(m);
    i++;
  }
  return out;
}
