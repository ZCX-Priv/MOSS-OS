// src/modules/agent/session.ts
// 会话状态与历史存储（上下文视图构建/裁剪/配对修复已迁入 context 引擎）。
// 持久化：每个 session 存为 ~/.moss/tasks/<groupId>/<sessionId>.json（归属分组由
// TaskStore 总管索引解析，engine 注入 resolveGroupId），启动时全量加载到内存。

import { t } from '../../core/i18n';
import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { safeSessionId, writeJsonStore } from '../filesys/store-io';
import type { AgentMessage, RunStats } from '../contracts';
import type { TodoItem } from '../tools/todo/shared/store';
import type { PermissionMode } from '../safety/types';
import type { Environment, Logger } from '../../core/types';
import type { CompactionRecord, EnvContextInfo, SessionContextTelemetry } from '../context/types';

/** 上下文文件轨迹（与前端 ContextFile 对齐） */
export interface ContextFile {
  path: string;
  tokens?: number;
  reason?: 'read' | 'edit' | 'write' | 'grep' | 'glob' | 'delete' | 'move' | 'copy';
}

export interface ActiveSkill {
  /** skill 名称（内容运行时从 skill 注册表按 name 解析，不持久化全文） */
  name: string;
  /**
   * 注入位置：
   *   - system：内容拼接在系统提示词后（首次激活）
   *   - message：内容作为 skill-inject system 消息锚定在切换消息后（切换激活）
   */
  mode: 'system' | 'message';
}

/** 旧格式 session 记录（含已废弃的全量提示词字段），仅用于加载时的类型窄化与主动清理检测 */
interface LegacySessionRecord {
  systemPrompt?: string;
  activeSkill?: { name?: string; mode?: 'system' | 'message'; content?: string };
}

export interface Session {
  id: string;
  /** 任务历史（不含系统提示词，仅 user/assistant/tool；skill-inject 的 system 消息只存单行占位标题，全文运行时从注册表解析） */
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
  /** 会话级权限模式（ask/auto/skip；前端 PermissionModeSelector 切换，随 run 持久化，刷新恢复） */
  permissionMode?: PermissionMode;
  /** 环境上下文锚定信息（context 引擎：会话首条 env-context 消息的生成时间/日期快照） */
  envContext?: EnvContextInfo;
  /** 压缩历史（context 引擎：每次压缩的记录，含摘要全文；前端压缩卡片数据源） */
  compactions?: CompactionRecord[];
  /** 持久化上下文遥测（context 引擎：真实 usage + 命中样本；重启恢复侧边栏/指标栏数据） */
  contextTelemetry?: SessionContextTelemetry;
  /** 最近一次 run 的运行统计（run 级口径：每次发送消息重置；中控台指标栏刷新恢复用） */
  lastRunStats?: RunStats;
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
  /** session 持久化根目录：~/.moss/tasks（session 文件按任务分组存于 tasks/<groupId>/） */
  private readonly tasksDir: string;
  /** sessionId → groupId 解析器（TaskStore 总管索引；未注入/未知返回 null → 兜底扫描/默认组） */
  private readonly resolveGroupId: (sessionId: string) => string | null;

  constructor(
    env: Environment,
    logger: Logger,
    opts?: { resolveGroupId?: (sessionId: string) => string | null },
  ) {
    this.logger = logger;
    this.tasksDir = join(env.dataDir, 'tasks');
    this.resolveGroupId = opts?.resolveGroupId ?? (() => null);
    this.loadAll();
  }

  /** 启动时全量加载所有 session 文件到内存（损坏文件跳过，目录不存在则跳过）。
   *  同时自愈存量错位文件：物理目录 ≠ 索引组时按索引搬移归位（历史 bug 修复后一次性迁移） */
  private loadAll(): void {
    try {
      if (!existsSync(this.tasksDir)) return;
      for (const entry of readdirSync(this.tasksDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        for (const name of readdirSync(join(this.tasksDir, entry.name))) {
          // 组内 task.json 是任务元信息（TaskStore 管），其余 .json 文件名即 sessionId
          if (!name.endsWith('.json') || name === 'task.json') continue;
          const sessionId = name.slice(0, -'.json'.length);
          // 错位自愈：索引指向其他组时搬到索引组（目标已存在则跳过，防覆盖）
          this.healMisplacedFile(sessionId, entry.name, name);
          if (!this.loadFromDisk(sessionId)) {
            this.logger.warn(t('agent.loadSessionFailed'), { file: `${entry.name}/${name}` });
          }
        }
      }
      this.logger.debug(t('agent.loadedSessions', { count: this.sessions.size }));
    } catch (err) {
      this.logger.warn(t('agent.scanSessionsDirFailed'), {
        dir: this.tasksDir,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 错位文件搬移：物理目录 ≠ 索引组且索引有效时，把文件搬到索引组目录。失败仅告警不阻断启动 */
  private healMisplacedFile(sessionId: string, physicalDir: string, fileName: string): void {
    const indexedGid = this.resolveGroupId(sessionId);
    if (!indexedGid) return; // 索引缺失（任务已删/孤儿文件）：保持原位
    const destDir = this.safeDirName(indexedGid);
    if (destDir === physicalDir) return;
    const src = join(this.tasksDir, physicalDir, fileName);
    const dest = join(this.tasksDir, destDir, fileName);
    try {
      if (existsSync(dest)) {
        this.logger.warn(t('agent.loadSessionFailed'), {
          file: `${physicalDir}/${fileName}`,
          reason: `dest exists: ${destDir}/${fileName}`,
        });
        return;
      }
      renameSync(src, dest);
      this.logger.info(t('agent.taskStoreMigrated', { count: 1 }), {
        sessionId,
        from: physicalDir,
        to: destDir,
      });
    } catch (err) {
      // 搬移失败保留原位：sessionFilePath 的磁盘扫描兜底仍可正确加载
      this.logger.warn(t('agent.taskStoreCleanupFailed'), {
        sessionId,
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

  /**
   * session 文件路径：tasks/<groupId>/<sessionId>.json。
   * 解析顺序：索引组文件存在 → 用索引组；否则磁盘扫描定位既有文件（存量错位文件
   * 自愈的关键：索引与物理位置不一致时按物理位置读写，下次 saveSession 自动归位）；
   * 均未命中落到默认组（新建 session）。sessionId 经 safeSessionId 清洗防路径穿越。
   */
  private sessionFilePath(sessionId: string): string {
    const sid = safeSessionId(sessionId);
    const indexedGid = this.resolveGroupId(sessionId);
    if (indexedGid) {
      const indexed = join(this.tasksDir, this.safeDirName(indexedGid), `${sid}.json`);
      if (existsSync(indexed)) return indexed;
    }
    const diskGid = this.findGroupIdOnDisk(sid);
    return join(this.tasksDir, diskGid ?? 'default', `${sid}.json`);
  }

  /** 组目录名清洗：与 TaskStore.safeGroupId 保持一致（防 `../` 等路径穿越） */
  private safeDirName(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '');
  }

  /** 兜底扫描：在各分组目录（tasks 下）定位 <sid>.json 既有文件，返回其所在组目录名；未找到返回 null */
  private findGroupIdOnDisk(sid: string): string | null {
    try {
      if (!existsSync(this.tasksDir)) return null;
      for (const entry of readdirSync(this.tasksDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (existsSync(join(this.tasksDir, entry.name, `${sid}.json`))) return entry.name;
      }
    } catch {
      // 扫描失败交由调用方回退默认组
    }
    return null;
  }

  /**
   * 从磁盘加载单个 session（启动 loadAll 与运行时冗余加载共用）。
   * 主动清理：检测到旧格式冗余（systemPrompt 字段 / activeSkill 固化全文 / skill-inject 全文消息）
   * 时先瘦身再立即原子重写文件，磁盘即时去除全量提示词。
   */
  private loadFromDisk(sessionId: string): Session | null {
    try {
      const filePath = this.sessionFilePath(sessionId);
      if (!existsSync(filePath)) return null;
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<Session> & LegacySessionRecord;
      if (typeof parsed.id === 'string' && Array.isArray(parsed.messages)) {
        const legacySkill = parsed.activeSkill;
        const hasLegacySkillContent = typeof legacySkill?.content === 'string';
        // skill-inject 全文消息特征：含 `\n\n`（占位格式只有单行标题）
        const hasFullSkillInject = parsed.messages.some(
          m => m.role === 'system' && m.name === 'skill-inject' && m.content.includes('\n\n'),
        );
        const dirty =
          parsed.systemPrompt !== undefined || hasLegacySkillContent || hasFullSkillInject;
        // 瘦身：全文 → 单行占位标题 + metadata.skillName（全文运行时从注册表解析）
        if (hasFullSkillInject) {
          for (const m of parsed.messages) {
            if (m.role === 'system' && m.name === 'skill-inject' && m.content.includes('\n\n')) {
              const fallbackName = /^# Active Skill: (.+)$/.exec(m.content)?.[1];
              const skillName = legacySkill?.name ?? fallbackName ?? 'unknown';
              m.content = `# Active Skill: ${skillName}`;
              m.metadata = { ...(m.metadata ?? {}), skillName };
            }
          }
        }
        const session: Session = {
          id: parsed.id,
          messages: parsed.messages,
          createdAt: parsed.createdAt ?? new Date().toISOString(),
          updatedAt: parsed.updatedAt ?? new Date().toISOString(),
          totalTokens: parsed.totalTokens ?? 0,
          contextFiles: Array.isArray(parsed.contextFiles) ? parsed.contextFiles : [],
          ...(legacySkill?.name && legacySkill.mode
            ? { activeSkill: { name: legacySkill.name, mode: legacySkill.mode } }
            : {}),
          ...(parsed.permissionMode ? { permissionMode: parsed.permissionMode } : {}),
          ...(parsed.envContext ? { envContext: parsed.envContext } : {}),
          ...(Array.isArray(parsed.compactions) ? { compactions: parsed.compactions } : {}),
          ...(parsed.lastRunStats ? { lastRunStats: parsed.lastRunStats } : {}),
          ...(parsed.lastTruncation ? { lastTruncation: parsed.lastTruncation } : {}),
        };
        this.sessions.set(session.id, session);
        if (dirty) {
          // 重写瘦身：旧 systemPrompt 等废弃字段不再写入，自然消失
          this.saveSession(session);
        }
        return session;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** 获取或创建会话（系统提示词不持久化，每次 run 由 engine 实时构建并拼接进发送视图） */
  getOrCreate(sessionId: string): Session {
    let session: Session | null = this.sessions.get(sessionId) ?? null;
    if (!session) {
      // 冗余保护：尝试从磁盘加载
      session = this.loadFromDisk(sessionId);
    }
    if (!session) {
      session = {
        id: sessionId,
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

  /** 设置会话级权限模式（变化时持久化；引擎每次 run 解析后调用） */
  setPermissionMode(session: Session, mode: PermissionMode): void {
    if (session.permissionMode === mode) return;
    session.permissionMode = mode;
    session.updatedAt = new Date().toISOString();
    this.saveSession(session);
  }

  /** 写入最近一次 run 统计（不落盘，由调用方按需 persistSession） */
  setLastRunStats(session: Session, stats: RunStats): void {
    session.lastRunStats = stats;
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
}
