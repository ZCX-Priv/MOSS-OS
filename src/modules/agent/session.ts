// src/modules/agent/session.ts
// 会话状态、历史、上下文裁剪。
// 持久化：每个 session 存为 ~/.moss/sessions/<sessionId>.json，启动时全量加载到内存。

import { t } from '../../core/i18n';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { safeSessionId, writeJsonStore } from '../filesys/store-io';
import type { AgentMessage } from '../contracts';
import type { UnifiedMessage } from '../llm/types';
import type { TodoItem } from '../tools/builtin/todo/shared/store';
import type { Environment, Logger } from '../../core/types';

/** 上下文文件轨迹（与前端 ContextFile 对齐） */
export interface ContextFile {
  path: string;
  tokens?: number;
  reason?: 'read' | 'edit' | 'write' | 'grep' | 'glob' | 'delete' | 'move' | 'copy';
}

export interface ActiveSkill {
  /** skill 名称 */
  name: string;
  /**
   * 注入位置：
   *   - system：内容拼接在系统提示词后（首次激活）
   *   - message：内容作为 skill-inject system 消息锚定在切换消息后（切换激活）
   */
  mode: 'system' | 'message';
  /** skill 指令内容（激活时刻固化；不含元数据） */
  content: string;
}

export interface Session {
  id: string;
  /** 系统提示词（独立存储，不混入任务历史） */
  systemPrompt: string;
  /** 任务历史（不含系统提示，仅 user/assistant/tool；可含 skill-inject 的 system 消息） */
  messages: AgentMessage[];
  /** 创建时间 */
  createdAt: string;
  /** 最后活跃时间 */
  updatedAt: string;
  /** 累计 token 用量（估算） */
  totalTokens: number;
  /** 上下文文件轨迹（read/edit/write/grep/glob 工具累积），随 session 持久化 */
  contextFiles: ContextFile[];
  /** 当前激活的 skill 模式（会话级持久；/ 菜单触发） */
  activeSkill?: ActiveSkill;
  /** 最近一次消息撤回（截断）的恢复信息（redo 用；新撤回覆盖旧的） */
  lastTruncation?: {
    /** 截断起点时间戳（目标用户消息的 timestamp） */
    truncatedBeforeTimestamp: string;
    /** 被软删除的消息在 messages 中的索引列表 */
    deletedIndexes: number[];
    /** 文件回滚产生的 rollback entry id 列表（file-history redo 备份） */
    rollbackEntryIds: string[];
  };
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
              ...(parsed.lastTruncation ? { lastTruncation: parsed.lastTruncation } : {}),
            };
            this.sessions.set(session.id, session);
          }
        } catch (err) {
          this.logger.warn(t('agent.loadSessionFailed'), {
            file: name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      this.logger.debug(t('agent.loadedSessions', { count: this.sessions.size }));
    } catch (err) {
      this.logger.warn(t('agent.scanSessionsDirFailed'), {
        dir: this.sessionsDir,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 把单个 session 持久化到磁盘（store-io 统一原子写：tmp+fsync+rename+EXDEV 回退） */
  private saveSession(session: Session): void {
    try {
      writeJsonStore(this.sessionFilePath(session.id), session);
    } catch (err) {
      this.logger.error(t('agent.saveSessionFailed'), {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** session 文件路径（sessionId 经 safeSessionId 清洗，防 `../` 路径穿越——与 transcript/todo 一致） */
  private sessionFilePath(sessionId: string): string {
    return join(this.sessionsDir, `${safeSessionId(sessionId)}.json`);
  }

  /** 从磁盘加载单个 session（冗余保护：eager load 后通常命中） */
  private loadFromDisk(sessionId: string): Session | null {
    try {
      const filePath = this.sessionFilePath(sessionId);
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
          ...(parsed.lastTruncation ? { lastTruncation: parsed.lastTruncation } : {}),
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
      this.logger.debug(t('agent.sessionCreated', { sessionId }));
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
      const filePath = this.sessionFilePath(sessionId);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch (err) {
      this.logger.warn(t('agent.deleteSessionFailed'), {
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
    session.messages.push({ role: 'user', content, timestamp: new Date().toISOString() });
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
      timestamp: new Date().toISOString(),
    });
    session.updatedAt = new Date().toISOString();
    this.saveSession(session);
  }

  /** 添加工具结果消息 */
  addToolMessage(
    session: Session,
    toolCallId: string,
    content: string,
    name?: string,
    extra?: { isError?: boolean; metadata?: Record<string, unknown> },
  ): void {
    session.messages.push({
      role: 'tool',
      content,
      toolCallId,
      name,
      isError: extra?.isError,
      metadata: extra?.metadata,
      timestamp: new Date().toISOString(),
    });
    session.updatedAt = new Date().toISOString();
    this.saveSession(session);
  }

  // ========================================================================
  // 消息撤回（截断）与恢复（redo）
  // ========================================================================

  /**
   * 定位目标用户消息索引：
   * 1) timestamp 最接近 messageTimestamp（±5 分钟内）的未删除 user 消息；
   * 2) 回退：从后往前第一条 content 完全匹配的未删除 user 消息。
   * 找不到返回 -1。
   */
  locateUserMessage(session: Session, messageTimestamp: string, content: string): number {
    const target = Date.parse(messageTimestamp);
    let bestIdx = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    if (!Number.isNaN(target)) {
      for (let i = 0; i < session.messages.length; i++) {
        const m = session.messages[i];
        if (m.role !== 'user' || m.deletedAt) continue;
        if (!m.timestamp) continue;
        const delta = Math.abs(Date.parse(m.timestamp) - target);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestIdx = i;
        }
      }
      if (bestIdx !== -1 && bestDelta <= 5 * 60 * 1000) return bestIdx;
    }
    // 回退：从后往前 content 精确匹配
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const m = session.messages[i];
      if (m.role !== 'user' || m.deletedAt) continue;
      if (m.content === content) return i;
    }
    return bestIdx !== -1 && bestDelta <= 5 * 60 * 1000 ? bestIdx : -1;
  }

  /**
   * 物理移除所有软删除消息（新截断覆盖旧截断时调用：旧恢复窗口已被覆盖，彻底清理）。
   * 调用后 messages 中不再有 deletedAt 标记，方可进行 locate + truncate。
   */
  purgeDeletedMessages(session: Session): void {
    const before = session.messages.length;
    session.messages = session.messages.filter(m => !m.deletedAt);
    if (session.messages.length !== before) {
      session.lastTruncation = undefined;
      this.saveSession(session);
    }
  }

  /**
   * 从目标用户消息起（含其后全部）标记软删除（索引基于 session.messages 全数组）。
   * @returns 被标记的消息数量（0 表示目标索引无效或无可删）
   */
  truncateFrom(session: Session, targetIndex: number): number {
    if (targetIndex < 0 || targetIndex >= session.messages.length) return 0;
    const now = new Date().toISOString();
    let count = 0;
    for (let i = targetIndex; i < session.messages.length; i++) {
      if (!session.messages[i].deletedAt) {
        session.messages[i].deletedAt = now;
        count++;
      }
    }
    if (count > 0) {
      session.updatedAt = now;
      this.saveSession(session);
    }
    return count;
  }

  /** 恢复最近一次截断：清除全部软删除标记（恢复窗口仅保留最近一步）并返回恢复数量 */
  restoreTruncated(session: Session): number {
    let restored = 0;
    for (const m of session.messages) {
      if (m.deletedAt) {
        m.deletedAt = undefined;
        restored++;
      }
    }
    session.lastTruncation = undefined;
    if (restored > 0) {
      session.updatedAt = new Date().toISOString();
      this.saveSession(session);
    }
    return restored;
  }

  /** 公共持久化入口（供 engine 在截断后写入 lastTruncation） */
  persistSession(session: Session): void {
    this.saveSession(session);
  }

  /**
   * 把 todo 快照附加到包含该 toolCallId 的 assistant 消息上（持久化）。
   * 快照仅首次写入（undefined 时冻结）：保留该消息 todo 调用时刻的状态，
   * 后续变更（含全部完成后被清空为 []）不再覆盖，防止历史 todo 卡片消失。
   */
  attachTodoSnapshot(session: Session, toolCallId: string, todos: TodoItem[]): void {
    let wrote = false;
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const m = session.messages[i];
      if (m.role === 'assistant' && m.toolCalls?.some((tc) => tc.id === toolCallId)) {
        if (m.todoSnapshot === undefined) {
          m.todoSnapshot = todos;
          wrote = true;
        }
        break;
      }
    }
    if (wrote) {
      session.updatedAt = new Date().toISOString();
      this.saveSession(session);
    }
  }

  /**
   * 统计会话上下文 token（粗略估算：1 char ≈ 0.5 token），更新内存 totalTokens。
   * 仅做统计，不修改、不裁剪 session.messages —— 历史消息是用户资产，
   * LLM 上下文窗口裁剪只应是"发送视图"（见 toUnifiedMessages 的 budgetTokens 参数），
   * 物理裁剪曾导致持久化历史丢失（首条 user 消息被裁掉后无法恢复）。
   */
  trimContext(session: Session, maxTokens: number): void {
    // 粗略估算：char 数 / 2 ≈ token 数
    const estimateTokens = (text: string): number => Math.ceil(text.length / 2);
    const systemTokens = estimateTokens(session.systemPrompt);
    let totalTokens = systemTokens;
    for (const m of session.messages) {
      if (m.deletedAt) continue;
      totalTokens += estimateTokens(m.content);
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          totalTokens += estimateTokens(tc.arguments);
        }
      }
    }
    session.totalTokens = totalTokens;
  }

  /** 把 AgentMessage 转为 LLM UnifiedMessage（头部拼接系统提示词）。软删除消息被过滤。
   *  activeSkill(mode='system') 的 skill 内容拼接在系统提示词后。
   *  budgetTokens（可选）：LLM 上下文窗口预算。超限时只发送尾部窗口（视图裁剪），
   *  不修改 session.messages。 */
  toUnifiedMessages(session: Session, budgetTokens?: number): UnifiedMessage[] {
    const active = session.messages.filter(m => !m.deletedAt);
    const windowed = budgetTokens === undefined ? active : this.computeContextWindow(session, active, budgetTokens);
    // 发送前自愈：保证 tool_use / tool_result 配对完整，避免历史脏数据触发
    // Anthropic HTTP 400（tool_use without tool_result）。不修改 session.messages。
    const sanitized = sanitizeMessages(windowed);
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
    // skill 模式（system 注入）：内容拼接在系统提示词后
    const skillSuffix =
      session.activeSkill?.mode === 'system'
        ? `\n\n---\n\n# Active Skill: ${session.activeSkill.name}\n\n${session.activeSkill.content}`
        : '';
    return [
      { role: 'system', content: session.systemPrompt + skillSuffix },
      ...conversation,
    ];
  }

  /**
   * 计算 LLM 上下文窗口（纯视图，不修改 session.messages）：
   * 超预算时保留尾部消息，并保证 tool_calls / tool 结果配对完整；
   * budget <= 0 或全部超限时保底保留最后一条（避免空对话触发 provider 400）。
   */
  private computeContextWindow(session: Session, active: AgentMessage[], maxTokens: number): AgentMessage[] {
    const estimateTokens = (text: string): number => Math.ceil(text.length / 2);
    const systemTokens = estimateTokens(session.systemPrompt);
    const budget = maxTokens - systemTokens - 500; // 留 500 token 余量

    // 从后往前保留，直到不超过预算
    const kept: AgentMessage[] = [];
    let used = 0;
    for (let i = active.length - 1; i >= 0; i--) {
      const m = active[i];
      const t = estimateTokens(m.content) + (m.toolCalls?.reduce((s, tc) => s + estimateTokens(tc.arguments), 0) ?? 0);
      if (used + t > budget) break;
      kept.unshift(m);
      used += t;
    }

    // 保底：至少保留最后一条（budget 异常/首条即超限时），sanitizeMessages 会兜底配对
    if (kept.length === 0 && active.length > 0) {
      kept.push(active[active.length - 1]);
    }

    // 配对完整性：
    // 1. 丢弃开头孤立的 tool 结果（对应的 assistant 不在窗口内）
    while (kept.length > 1 && kept[0].role === 'tool') {
      kept.shift();
    }
    // 2. 从后往前扫描，带 tool_calls 的 assistant 若缺对应 tool 结果则整组丢弃
    for (let i = kept.length - 1; i >= 0; i--) {
      const m = kept[i];
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        const expectedIds = new Set(m.toolCalls.map(tc => tc.id));
        let j = i + 1;
        while (j < kept.length && kept[j].role === 'tool') {
          j++;
        }
        const foundIds = new Set(kept.slice(i + 1, j).map(t => t.toolCallId));
        const allCovered = [...expectedIds].every(id => foundIds.has(id));
        if (!allCovered) {
          kept.splice(i, j - i);
        }
      }
    }
    // 整组丢弃后可能再次出现保底丢失，兜底最后一条
    if (kept.length === 0 && active.length > 0) {
      kept.push(active[active.length - 1]);
    }
    this.logger.debug(t('agent.contextTrimmed', { messages: kept.length, tokens: systemTokens + used }));
    return kept;
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
