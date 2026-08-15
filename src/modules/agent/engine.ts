// src/modules/agent/engine.ts
// Agent ReAct 循环引擎。

import { t } from '../../core/i18n';
import { buildSystemPrompt, buildTools } from './context';
import { SessionStore, type ContextFile, type Session } from './session';
import { TaskStore, type TaskItem, type TaskGroup } from './task-store';
import { LLMError, type UnifiedRequest } from '../llm/types';
import type {
  AgentMessage,
  AgentEngine,
  AgentEvent,
  AgentRunInput,
  AgentRunResult,
  TruncatePreview,
  TruncateResult,
  TruncateRestoreResult,
} from '../contracts';
import type { LLMRouter, ToolRegistry, MCPManager, FileHistoryService, FilesysService } from '../contracts';
import type { FileChangeEvent } from '../filesys/types';
import type { ConfigService, EventBus, Logger, ServiceRegistry, Environment, ApiConfig } from '../../core/types';
import { ServiceNames } from '../../core/types';
import type { AskOutcome, AskPayload, ToolResult } from '../tools/types';
import type { SkillRegistry } from '../tools/skills';
import { readSessionTodoStore, getSessionTodoPath } from '../tools/builtin/todo/shared/store';

/** ask 超时兜底上限（即使配置异常也不会让 Promise 永久悬挂） */
const ASK_TIMEOUT_CEILING_MS = 24 * 60 * 60 * 1000; // 24h

export class AgentEngineImpl implements AgentEngine {
  private readonly sessions: SessionStore;
  private readonly tasks: TaskStore;
  private readonly services: ServiceRegistry;
  private readonly config: ConfigService;
  private readonly eventBus: EventBus;
  private readonly logger: Logger;
  private readonly env: Environment;
  /** filesys 事件订阅取消函数（destroy 时调用） */
  private unsubFilesys: (() => void) | null = null;
  /** pending ask 调用：toolCallId -> { resolve, reject, timer?, sessionId, payload } */
  private readonly pendingAsks = new Map<string, {
    resolve: (outcome: AskOutcome) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout> | null;
    sessionId: string;
    payload: AskPayload;
  }>();

  /** pending confirm 调用：toolCallId -> { resolve, reject, timer, sessionId, question } */
  private readonly pendingConfirms = new Map<string, {
    resolve: (ok: boolean) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    sessionId: string;
    question: string;
  }>();

  constructor(deps: {
    services: ServiceRegistry;
    config: ConfigService;
    eventBus: EventBus;
    logger: Logger;
    env: Environment;
  }) {
    this.services = deps.services;
    this.config = deps.config;
    this.eventBus = deps.eventBus;
    this.logger = deps.logger;
    this.env = deps.env;
    this.sessions = new SessionStore(deps.env, deps.logger);
    this.tasks = new TaskStore(deps.env, deps.logger);

    // 订阅 filesys 变更事件总线：file-created/edited/deleted/moved/shell-changed 统一转 WS，
    // delete/move/copy 的路径进 contextFiles（修复旧版无任何通知的割裂）。
    // filesys 模块在 kernel 中先于 agent 注册（见 core/kernel.ts 模块顺序）。
    const filesys = deps.services.tryResolve<FilesysService>(ServiceNames.FILESYS);
    if (filesys) {
      this.unsubFilesys = filesys.onFileChange((e) => this.onFilesysChange(e));
    }
  }

  /** 释放资源（模块 destroy 时调用）：取消 filesys 事件订阅 */
  dispose(): void {
    if (this.unsubFilesys) {
      this.unsubFilesys();
      this.unsubFilesys = null;
    }
  }

  /** filesys 变更事件 → WS 推送 + contextFiles 轨迹 */
  private onFilesysChange(e: FileChangeEvent): void {
    if (!e.sessionId) return;
    const server = this.services.tryResolve<{
      sendToSession: (sid: string, msg: unknown) => void;
    }>(ServiceNames.SERVER_INSTANCE);
    if (!server) return;

    try {
      // 变更路径进 contextFiles（moved 记目标路径；delete/move/copy 首次纳入轨迹）
      const reason = e.source as ContextFile['reason'];
      if (reason === 'write' || reason === 'edit' || reason === 'delete' || reason === 'move' || reason === 'copy') {
        this.sessions.addContextFile(e.sessionId, { path: e.destPath ?? e.absPath, reason });
        const files = this.sessions.getContextFiles(e.sessionId);
        const totalTokens = this.sessions.estimateContextTokens(e.sessionId);
        const maxTokens = this.config.getAppConfig().agent.maxTokens * 4;
        server.sendToSession(e.sessionId, {
          type: 'context-updated',
          sessionId: e.sessionId,
          payload: { files, totalTokens, maxTokens },
        });
      }

      switch (e.kind) {
        case 'created':
          server.sendToSession(e.sessionId, {
            type: 'file-created', sessionId: e.sessionId,
            payload: { path: e.absPath, source: e.source },
          });
          break;
        case 'edited':
          server.sendToSession(e.sessionId, {
            type: 'file-edited', sessionId: e.sessionId,
            payload: { path: e.absPath, source: e.source },
          });
          break;
        case 'deleted':
          server.sendToSession(e.sessionId, {
            type: 'file-deleted', sessionId: e.sessionId,
            payload: { path: e.absPath, source: e.source },
          });
          break;
        case 'moved':
          server.sendToSession(e.sessionId, {
            type: 'file-moved', sessionId: e.sessionId,
            payload: { path: e.absPath, destPath: e.destPath, source: e.source },
          });
          break;
        case 'shell-changed':
          server.sendToSession(e.sessionId, {
            type: 'shell-changed', sessionId: e.sessionId,
            payload: { report: e.report },
          });
          break;
      }
    } catch (err) {
      this.logger.warn(t('agent.notifySideEffectsFailed'), {
        kind: e.kind,
        path: e.absPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const { sessionId, userMessage, cwd, onEvent, signal } = input;
    const cfg = this.config.getAppConfig().agent;
    const model = input.model ?? cfg.defaultModel;

    this.logger.info(t('agent.runStart'), { sessionId, model });

    // 解析依赖服务
    const llm = this.services.tryResolve<LLMRouter>(ServiceNames.LLM_ROUTER);
    if (!llm) {
      const msg = 'LLM router not available';
      onEvent({ type: 'error', sessionId, message: msg });
      return {
        sessionId,
        finishReason: 'error',
        finalText: msg,
        history: [],
      };
    }

    const toolRegistry = this.services.tryResolve<ToolRegistry>(ServiceNames.TOOL_REGISTRY);
    const mcpManager = this.services.tryResolve<MCPManager>(ServiceNames.MCP_MANAGER);

    // 构建会话 + 系统提示（注入模型信息用于 {{model_id}}/{{model_name}} 变量替换）
    const apiCfg = this.config.getApiConfig();
    const modelDisplayName = resolveModelDisplayName(apiCfg, model);
    const systemPrompt = buildSystemPrompt(this.env, cwd, model, modelDisplayName);
    const session = this.sessions.getOrCreate(sessionId, systemPrompt);
    this.sessions.addUserMessage(session, userMessage);
    // 活跃置顶：task.id 即 sessionId；无对应任务时静默返回 null
    this.tasks.touchTask(sessionId);

    // skill 模式处理（/ 菜单触发：payload.skill 非空=激活/切换；null=退出）
    if (input.skill !== undefined) {
      this.applySkillMode(session, input.skill, onEvent, sessionId);
    }

    // 工具集（含 MCP 工具）
    let mcpTools: Array<{ server: string; name: string; description?: string; inputSchema?: unknown }> = [];
    try {
      mcpTools = mcpManager?.listTools() ?? [];
    } catch (err) {
      this.logger.warn(t('agent.listMcpToolsFailed'), {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const tools = buildTools(toolRegistry, mcpTools);

    // ReAct 循环
    let turn = 0;
    const maxTurns = cfg.maxTurns;
    let finalText = '';
    let finishReason: AgentRunResult['finishReason'] = 'stop';

    while (turn < maxTurns) {
      if (signal?.aborted) {
        finishReason = 'aborted';
        break;
      }
      turn++;

      // 构建请求
      this.sessions.trimContext(session, cfg.maxTokens * 4); // 留余量
      const messages = this.sessions.toUnifiedMessages(session);

      const req: UnifiedRequest = {
        model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        stream: true,
        max_tokens: cfg.maxTokens,
        toolChoice: 'auto',
      };

      // 流式调用 LLM
      let assistantText = '';
      let assistantThinking = '';
      const toolCallAccumulators = new Map<number, { id: string; name: string; args: string }>();

      try {
        for await (const delta of llm.stream(req, signal)) {
          if (signal?.aborted) break;

          switch (delta.type) {
            case 'text':
              assistantText += delta.text;
              onEvent({ type: 'assistant-text', sessionId, text: delta.text });
              break;
            case 'thinking':
              assistantThinking += delta.text;
              onEvent({ type: 'assistant-thinking', sessionId, text: delta.text });
              break;
            case 'tool_call': {
              const wasNew = !toolCallAccumulators.has(delta.index);
              const existing = toolCallAccumulators.get(delta.index) ?? {
                id: delta.toolCallId,
                name: delta.name,
                args: '',
              };
              if (delta.toolCallId) existing.id = delta.toolCallId;
              if (delta.name) existing.name = delta.name;
              existing.args += delta.argumentsDelta;
              toolCallAccumulators.set(delta.index, existing);

              // 首次收到该 index：推送 tool-call-start（LLM 开始生成工具调用）
              if (wasNew) {
                onEvent({
                  type: 'tool-call-start',
                  sessionId,
                  toolName: existing.name,
                  toolCallId: existing.id,
                  args: '',
                });
              }
              // 参数增量推送（toolCallId 已确定后才有意义）
              if (delta.argumentsDelta && existing.id) {
                onEvent({
                  type: 'tool-call-delta',
                  sessionId,
                  toolCallId: existing.id,
                  argumentsDelta: delta.argumentsDelta,
                });
              }
              break;
            }
            case 'finish':
              if (delta.finishReason === 'length') {
                finishReason = 'length';
              }
              break;
            case 'error':
              onEvent({ type: 'error', sessionId, message: delta.message });
              finishReason = 'error';
              break;
            case 'usage':
              // 可记录但无需推送
              break;
          }
        }
      } catch (err) {
        if (signal?.aborted) {
          // 用户主动中断：不发 error 事件，静默退出
          finishReason = 'aborted';
          finalText = assistantText;
          if (finalText || assistantThinking) {
            this.sessions.addAssistantMessage(session, finalText, undefined, assistantThinking || undefined);
          }
          break;
        }
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(t('agent.llmStreamFailed'), { error: msg, turn });
        onEvent({ type: 'error', sessionId, message: msg });
        finishReason = 'error';
        // 把已收集的文本作为最终输出
        finalText = assistantText || `Error: ${msg}`;
        this.sessions.addAssistantMessage(session, finalText, undefined, assistantThinking || undefined);
        break;
      }

      if (signal?.aborted) {
        finishReason = 'aborted';
        break;
      }

      // 收集工具调用
      const toolCalls: AgentMessage['toolCalls'] = [];
      for (const [, acc] of toolCallAccumulators) {
        if (acc.name) {
          toolCalls.push({
            id: acc.id || `call_${turn}_${Math.random().toString(36).slice(2, 8)}`,
            name: acc.name,
            arguments: acc.args,
          });
        }
      }

      // 记录 assistant 消息
      this.sessions.addAssistantMessage(
        session,
        assistantText,
        toolCalls.length > 0 ? toolCalls : undefined,
        assistantThinking || undefined,
      );

      // 无工具调用：本轮结束
      if (toolCalls.length === 0) {
        finalText = assistantText;
        if (finishReason !== 'length' && finishReason !== 'error') {
          finishReason = 'stop';
        }
        break;
      }

      // 执行工具调用
      for (const tc of toolCalls) {
        if (signal?.aborted) {
          // abort 时补一个错误 tool 结果，保持 tool_calls 配对完整
          // 否则 assistant 消息已带 tool_calls 但缺少对应 tool 结果，session 复用时会触发 HTTP 400
          this.sessions.addToolMessage(
            this.sessions.get(sessionId)!,
            tc.id,
            'Error: aborted by user',
            tc.name,
            { isError: true },
          );
          finishReason = 'aborted';
          continue;
        }
        // 单工具失败隔离：executeToolCall 抛错时兜底补错误 tool_result，
        // 避免中断后续 tc 导致多个 tool_use 失去 tool_result（触发 HTTP 400）。
        try {
          await this.executeToolCall(tc, {
            sessionId,
            cwd,
            toolCallId: tc.id,
            onEvent,
            signal,
          });
          // 工具执行完毕后检查 abort，避免继续下一轮
          if (signal?.aborted) {
            finishReason = 'aborted';
            break;
          }
        } catch (err) {
          this.logger.error(t('agent.executeToolCallThrew'), {
            toolCallId: tc.id,
            toolName: tc.name,
            error: err instanceof Error ? err.message : String(err),
          });
          this.sessions.addToolMessage(
            this.sessions.get(sessionId)!,
            tc.id,
            `Error: ${err instanceof Error ? err.message : String(err)}`,
            tc.name,
            { isError: true },
          );
        }
      }

      if (finishReason === 'aborted') break;

      // 继续下一轮（让 LLM 看到工具结果后继续）
      finalText = assistantText;
    }

    if (turn >= maxTurns && finishReason === 'stop') {
      this.logger.warn(t('agent.reachedMaxTurns', { maxTurns }), { sessionId });
      finishReason = 'length';
    }

    onEvent({ type: 'done', sessionId, finishReason });

    // 兜底清理未完成的 ask（正常流程下应已被 resolve/reject）
    this.cleanupPendingAsks();

    this.logger.info(t('agent.runComplete'), { sessionId, turn, finishReason });

    return {
      sessionId,
      finishReason,
      finalText,
      history: session.messages,
    };
  }

  // ========================================================================

  /** 列出所有会话（供 Server 路由调用） */
  listSessions(): Array<{ id: string; createdAt: string; updatedAt: string; messageCount: number }> {
    return this.sessions.list().map(s => ({
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages.length,
    }));
  }

  /** 获取会话历史（不含已撤回的软删除消息） */
  getHistory(sessionId: string): AgentMessage[] {
    return (this.sessions.get(sessionId)?.messages ?? []).filter(m => !m.deletedAt);
  }

  // ========================================================================
  // 消息撤回（截断）与恢复（redo）
  // ========================================================================

  previewTruncate(sessionId: string, messageTimestamp: string, content: string): TruncatePreview | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    this.sessions.purgeDeletedMessages(session);
    const idx = this.sessions.locateUserMessage(session, messageTimestamp, content);
    if (idx === -1) return null;

    const messagesToRemove = session.messages.slice(idx)
      .filter(m => !m.deletedAt)
      .map((m, i) => ({
        index: idx + i,
        role: m.role,
        content: m.content.length > 120 ? `${m.content.slice(0, 120)}…` : m.content,
        ...(m.timestamp ? { timestamp: m.timestamp } : {}),
      }));

    // 文件回滚区间：目标消息 timestamp → 最后一条消息 timestamp（旧消息无 timestamp 时跳过回滚）
    const from = session.messages[idx]?.timestamp;
    let to: string | undefined;
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].timestamp && !session.messages[i].deletedAt) {
        to = session.messages[i].timestamp;
        break;
      }
    }
    const fileChanges: TruncatePreview['fileChanges'] = [];
    if (from && to) {
      const fh = this.resolveFileHistory();
      if (fh) {
        const fromMs = Date.parse(from);
        const toMs = Date.parse(to);
        for (const e of fh.listHistory(sessionId)) {
          if (e.toolName === 'rollback') continue;
          const ts = Date.parse(e.timestamp);
          if (Number.isNaN(ts) || ts < fromMs || ts > toMs) continue;
          fileChanges.push({ absPath: e.absPath, operation: e.operation, toolName: e.toolName, timestamp: e.timestamp });
        }
      }
    }
    return { messagesToRemove, fileChanges };
  }

  async truncateFrom(sessionId: string, messageTimestamp: string, content: string): Promise<TruncateResult | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    // 新截断覆盖旧恢复窗口：物理清除旧软删除
    this.sessions.purgeDeletedMessages(session);
    const idx = this.sessions.locateUserMessage(session, messageTimestamp, content);
    if (idx === -1) return null;
    const targetMsg = session.messages[idx];
    const truncatedBeforeTimestamp = targetMsg.timestamp ?? messageTimestamp;

    // 先做文件回滚（基于截断前完整区间），再做消息软删除
    const rollbackFailed: TruncateResult['rollbackFailed'] = [];
    let rollbackEntryIds: string[] = [];
    let fileRollbackPerformed = false;
    const from = targetMsg.timestamp;
    let to: string | undefined;
    for (let i = session.messages.length - 1; i >= idx; i--) {
      if (session.messages[i].timestamp) {
        to = session.messages[i].timestamp;
        break;
      }
    }
    if (from && to) {
      const fh = this.resolveFileHistory();
      if (fh) {
        fileRollbackPerformed = true;
        try {
          const rb = await fh.rollbackRange(sessionId, from, to);
          rollbackEntryIds = rb.rollbackIds;
          rollbackFailed.push(...rb.failed);
        } catch (err) {
          rollbackFailed.push({
            absPath: '',
            error: `rollbackRange threw: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }

    // 消息软删除
    const removedCount = this.sessions.truncateFrom(session, idx);

    // 记录 lastTruncation（redo 用）
    session.lastTruncation = {
      truncatedBeforeTimestamp,
      deletedIndexes: [],
      rollbackEntryIds,
    };
    // 直接落盘（saveSession 是私有方法，通过再次触发软删除持久化路径覆盖）
    this.sessions.persistSession(session);

    // 通知前端
    const server = this.services.tryResolve<{ sendToSession: (sid: string, msg: unknown) => void }>(ServiceNames.SERVER_INSTANCE);
    server?.sendToSession(sessionId, {
      type: 'session-truncated',
      sessionId,
      payload: {
        messageTimestamp: truncatedBeforeTimestamp,
        removedCount,
      },
    });

    this.logger.info('agent: session truncated', {
      sessionId,
      removedCount,
      rollbackEntries: rollbackEntryIds.length,
      rollbackFailed: rollbackFailed.length,
    });

    return {
      removedCount,
      rolledBackFiles: Math.max(rollbackEntryIds.length - rollbackFailed.length, 0),
      rollbackFailed,
      truncatedBeforeTimestamp,
      fileRollbackPerformed,
    };
  }

  async restoreTruncate(sessionId: string): Promise<TruncateRestoreResult | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const info = session.lastTruncation;
    if (!info) return null;

    // 先恢复文件（redo rollback），再恢复消息
    const restoreFailed: TruncateRestoreResult['restoreFailed'] = [];
    let restoredFiles = 0;
    if (info.rollbackEntryIds.length > 0) {
      const fh = this.resolveFileHistory();
      if (fh) {
        try {
          const rr = await fh.redoRollback(sessionId, info.rollbackEntryIds);
          restoreFailed.push(...rr.failed);
          restoredFiles = info.rollbackEntryIds.length - rr.failed.length;
        } catch (err) {
          restoreFailed.push({
            absPath: '',
            error: `redoRollback threw: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }

    const restoredCount = this.sessions.restoreTruncated(session);

    const server = this.services.tryResolve<{ sendToSession: (sid: string, msg: unknown) => void }>(ServiceNames.SERVER_INSTANCE);
    server?.sendToSession(sessionId, {
      type: 'session-restored',
      sessionId,
      payload: { restoredCount, restoredFiles },
    });

    this.logger.info('agent: session truncation restored', { sessionId, restoredCount, restoredFiles });

    return { restoredCount, restoredFiles, restoreFailed };
  }

  private resolveFileHistory(): FileHistoryService | null {
    return this.services.tryResolve<FileHistoryService>(ServiceNames.FILE_HISTORY);
  }

  /** 获取会话上下文文件轨迹（阶段5.1：供 session-context 路由回填） */
  getContextFiles(sessionId: string): ContextFile[] {
    return this.sessions.getContextFiles(sessionId);
  }

  /** 估算会话上下文文件累计 token 数（阶段5.1：供 session-context 路由回填） */
  estimateContextTokens(sessionId: string): number {
    return this.sessions.estimateContextTokens(sessionId);
  }

  /** 删除会话 */
  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  // ========================================================================
  // 任务管理（供 Server 路由调用）
  // ========================================================================

  listTasks(): TaskItem[] {
    return this.tasks.listTasks();
  }

  getTask(id: string): TaskItem | null {
    return this.tasks.getTask(id);
  }

  createTask(title: string, groupId?: string): TaskItem {
    return this.tasks.createTask(title, groupId);
  }

  updateTask(id: string, patch: { title?: string; groupId?: string }): TaskItem | null {
    return this.tasks.updateTask(id, patch);
  }

  deleteTask(id: string): boolean {
    return this.tasks.deleteTask(id);
  }

  /** 按给定 id 顺序重排任务 order（分组内排序持久化） */
  reorderTasks(taskIds: string[]): boolean {
    return this.tasks.reorderTasks(taskIds);
  }

  listTaskGroups(): TaskGroup[] {
    return this.tasks.listGroups();
  }

  createTaskGroup(name: string): TaskGroup {
    return this.tasks.createGroup(name);
  }

  updateTaskGroup(id: string, patch: { name?: string }): TaskGroup | null {
    return this.tasks.updateGroup(id, patch);
  }

  deleteTaskGroup(id: string, moveTasksTo?: string): boolean {
    return this.tasks.deleteGroup(id, moveTasksTo);
  }

  /** 搜索任务标题 + 会话消息内容 */
  searchAll(query: string): {
    tasks: TaskItem[];
    messages: Array<{ sessionId: string; messageId: string; text: string }>;
  } {
    const tasks = this.tasks.searchTasks(query);
    const q = query.toLowerCase();
    const messages: Array<{ sessionId: string; messageId: string; text: string }> = [];
    for (const session of this.sessions.list()) {
      for (const msg of session.messages) {
        if (msg.deletedAt) continue;
        if (msg.role === 'user' || msg.role === 'assistant') {
          if (msg.content.toLowerCase().includes(q)) {
            messages.push({
              sessionId: session.id,
              messageId: `${session.id}-${session.messages.indexOf(msg)}`,
              text: msg.content.slice(0, 200),
            });
          }
        }
      }
    }
    return { tasks, messages };
  }

  // ========================================================================

  private async executeToolCall(
    tc: NonNullable<AgentMessage['toolCalls']>[number],
    ctx: {
      sessionId: string;
      cwd: string;
      toolCallId: string;
      onEvent: (event: AgentEvent) => void;
      signal?: AbortSignal;
    },
  ): Promise<void> {
    const { sessionId, cwd, toolCallId, onEvent, signal } = ctx;

    // 工具执行前再次检查 abort（防止在工具队列等待期间被 abort）
    if (signal?.aborted) {
      this.sessions.addToolMessage(
        this.sessions.get(sessionId)!,
        toolCallId,
        'Error: aborted by user',
        tc.name,
        { isError: true },
      );
      return;
    }

    onEvent({
      type: 'tool-call-executing',
      sessionId,
      toolName: tc.name,
      toolCallId,
    });

    // 解析参数
    let args: unknown;
    try {
      args = JSON.parse(tc.arguments || '{}');
    } catch {
      args = {};
    }

    // 判断是否是 MCP 工具（mcp__server__tool 前缀）
    const mcpMatch = tc.name.match(/^mcp__([^_]+)__(.+)$/);
    let result: ToolResult;
    try {
      if (mcpMatch) {
        result = await this.executeMcpTool(mcpMatch[1], mcpMatch[2], args, ctx);
      } else {
        result = await this.executeBuiltinTool(tc.name, args, ctx);
      }
    } catch (err) {
      // 工具执行抛异常时，补一个错误 ToolResult，确保 addToolMessage 一定执行
      // 否则 assistant 消息已带 tool_calls 但缺少对应 tool 结果，session 复用时会触发 HTTP 400
      result = {
        content: [{ type: 'text', text: `Error executing tool ${tc.name}: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }

    // 记录工具结果到会话
    // resultText 计算包进 try/catch：运行时 content 数据异常（如 source 缺失）不应
    // 阻止 addToolMessage 执行，否则 assistant 的 tool_use 会缺少对应 tool_result，
    // session 复用时会触发 HTTP 400。
    let resultText: string;
    try {
      resultText = result.content
        .map(c => (c.type === 'text' ? c.text : `[image: ${c.source?.mimeType ?? 'unknown'}]`))
        .join('\n');
    } catch (err) {
      resultText = `Error: failed to serialize tool result: ${err instanceof Error ? err.message : String(err)}`;
    }
    this.sessions.addToolMessage(
      this.sessions.get(sessionId)!,
      toolCallId,
      resultText,
      tc.name,
      { isError: result.isError, metadata: result.metadata },
    );

    onEvent({
      type: 'tool-call-end',
      sessionId,
      toolName: tc.name,
      toolCallId,
      result,
    });

    // 阶段5.1：工具执行副作用 WS 推送（todo-updated / context-updated / file-*）
    this.notifyToolSideEffects(tc.name, args, sessionId, toolCallId);
  }

  /**
   * 工具执行后的副作用 WS 推送（阶段5.1）：
   * - todo 工具：推送 todo-updated（会话级存储，读该 session 的文件）
   * - read/grep/glob：更新 contextFiles 轨迹并推送 context-updated（只读访问，非变更）
   * - write/edit/delete/move/copy 的 file-* 事件与 contextFiles 由 filesys 变更事件总线驱动
   *   （onFilesysChange，避免双发且天然覆盖 delete/move 等旧版无通知的工具）
   * server 模块未加载时静默跳过，不阻断工具执行。
   */
  private notifyToolSideEffects(toolName: string, args: unknown, sessionId: string, toolCallId: string): void {
    const server = this.services.tryResolve<{
      sendToSession: (sid: string, msg: unknown) => void;
    }>(ServiceNames.SERVER_INSTANCE);
    if (!server) return;

    try {
      switch (toolName) {
        case 'todo': {
          // 会话级存储：直接读该 session 的文件（天然隔离）
          const store = readSessionTodoStore(getSessionTodoPath(this.env, sessionId));
          const todos = store.items;
          // 持久化快照到 assistant 消息（刷新后可恢复）
          const session = this.sessions.get(sessionId);
          if (session) this.sessions.attachTodoSnapshot(session, toolCallId, todos);
          server.sendToSession(sessionId, {
            type: 'todo-updated',
            sessionId,
            payload: { todos, toolCallId },
          });
          break;
        }
        case 'read':
        case 'grep':
        case 'glob': {
          // 只读访问：仅更新 contextFiles 轨迹（file-* 事件由 filesys 变更事件总线驱动，见 onFilesysChange）
          const path = (args as { path?: string } | null)?.path;
          if (!path) break;
          const file: ContextFile = { path, reason: toolName as ContextFile['reason'] };
          this.sessions.addContextFile(sessionId, file);
          const files = this.sessions.getContextFiles(sessionId);
          const totalTokens = this.sessions.estimateContextTokens(sessionId);
          const maxTokens = this.config.getAppConfig().agent.maxTokens * 4;
          server.sendToSession(sessionId, {
            type: 'context-updated',
            sessionId,
            payload: { files, totalTokens, maxTokens },
          });
          break;
        }
        default:
          break;
      }
    } catch (err) {
      this.logger.warn(t('agent.notifySideEffectsFailed'), {
        toolName,
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async executeBuiltinTool(
    name: string,
    args: unknown,
    ctx: {
      sessionId: string;
      cwd: string;
      toolCallId: string;
      onEvent: (event: AgentEvent) => void;
      signal?: AbortSignal;
    },
  ): Promise<ToolResult> {
    const toolRegistry = this.services.tryResolve<ToolRegistry>(ServiceNames.TOOL_REGISTRY);
    if (!toolRegistry) {
      return {
        content: [{ type: 'text', text: 'Error: tool registry not available' }],
        isError: true,
      };
    }

    // tool:before hook
    await this.eventBus.emit('tool:before', { name, args, sessionId: ctx.sessionId });

    const result = await toolRegistry.execute(name, args, {
      sessionId: ctx.sessionId,
      cwd: ctx.cwd,
      toolCallId: ctx.toolCallId,
      emit: (event) => {
        // 工具进度事件通过 AgentEvent 转发
        if (event.type === 'progress') {
          ctx.onEvent({
            type: 'tool-call-start',
            sessionId: ctx.sessionId,
            toolName: name,
            toolCallId: ctx.toolCallId,
            args: event.message,
          });
        } else if (event.type === 'confirm-required') {
          ctx.onEvent({
            type: 'confirm-required',
            sessionId: ctx.sessionId,
            toolCallId: ctx.toolCallId,
            toolName: name,
            question: event.message,
            details: event.details,
          });
        }
      },
      logger: this.logger,
      services: this.services,
      signal: ctx.signal,
      askUser: (payload: AskPayload) => {
        return new Promise<AskOutcome>((resolve, reject) => {
          // 超时从 config.tools.ask.timeoutMinutes 读取（0/缺省 = 永不超时），兜底上限 24h
          let timeoutMs = 0;
          try {
            const askCfg = (this.config.getAppConfig().tools as Record<string, Record<string, unknown>>)?.['ask'];
            const raw = askCfg?.timeoutMinutes;
            if (typeof raw === 'number' && raw > 0) timeoutMs = raw * 60 * 1000;
          } catch {
            // config 不可用：永不超时
          }
          const timer = timeoutMs > 0 ? setTimeout(() => {
            if (this.pendingAsks.delete(ctx.toolCallId)) {
              reject(new Error(`ask timeout after ${Math.round(timeoutMs / 60000)}min`));
              // 通知前端移除残留卡片
              ctx.onEvent({ type: 'ask-timeout', sessionId: ctx.sessionId, toolCallId: ctx.toolCallId });
            }
          }, Math.min(timeoutMs, ASK_TIMEOUT_CEILING_MS)) : null;
          this.pendingAsks.set(ctx.toolCallId, {
            resolve,
            reject,
            timer,
            sessionId: ctx.sessionId,
            payload,
          });
          // 中断时立即 reject
          if (ctx.signal) {
            ctx.signal.addEventListener(
              'abort',
              () => {
                const pending = this.pendingAsks.get(ctx.toolCallId);
                if (pending) {
                  if (pending.timer) clearTimeout(pending.timer);
                  this.pendingAsks.delete(ctx.toolCallId);
                  reject(new Error('aborted'));
                }
              },
              { once: true },
            );
          }
          ctx.onEvent({
            type: 'ask',
            sessionId: ctx.sessionId,
            toolCallId: ctx.toolCallId,
            question: payload.question,
            answerType: payload.answerType,
            options: payload.options,
            defaultAnswer: payload.defaultAnswer,
          });
        });
      },
      confirm: (question: string) => {
        return new Promise<boolean>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pendingConfirms.delete(ctx.toolCallId);
            resolve(false);
          }, 5 * 60 * 1000);
          this.pendingConfirms.set(ctx.toolCallId, {
            resolve,
            reject,
            timer,
            sessionId: ctx.sessionId,
            question,
          });
          if (ctx.signal) {
            ctx.signal.addEventListener(
              'abort',
              () => {
                if (this.pendingConfirms.has(ctx.toolCallId)) {
                  clearTimeout(timer);
                  this.pendingConfirms.delete(ctx.toolCallId);
                  reject(new Error('aborted'));
                }
              },
              { once: true },
            );
          }
          ctx.onEvent({
            type: 'confirm-required',
            sessionId: ctx.sessionId,
            toolCallId: ctx.toolCallId,
            toolName: name,
            question,
            details: args,
          });
        });
      },
    });

    // tool:after hook
    await this.eventBus.broadcast('tool:after', {
      name,
      args,
      sessionId: ctx.sessionId,
      result,
    });

    return result;
  }

  /** 前端回复 ask 提问（accept/cancel）。匹配到 pending 则 resolve 并返回 true。 */
  resolveAsk(toolCallId: string, outcome: AskOutcome): boolean {
    const pending = this.pendingAsks.get(toolCallId);
    if (!pending) return false;
    if (pending.timer) clearTimeout(pending.timer);
    this.pendingAsks.delete(toolCallId);
    pending.resolve(outcome);
    return true;
  }

  /** 列出某 session 的待答 ask（供 WS 重连恢复 pending asks，携带完整提问载荷）。 */
  getPendingAsks(sessionId: string): Array<{ toolCallId: string; sessionId: string; payload: AskPayload }> {
    const out: Array<{ toolCallId: string; sessionId: string; payload: AskPayload }> = [];
    for (const [toolCallId, pending] of this.pendingAsks) {
      if (pending.sessionId === sessionId) {
        out.push({ toolCallId, sessionId: pending.sessionId, payload: pending.payload });
      }
    }
    return out;
  }

  /** 前端回复 confirm 确认。匹配到 pending 则 resolve 并返回 true。 */
  resolveConfirm(toolCallId: string, ok: boolean): boolean {
    const pending = this.pendingConfirms.get(toolCallId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingConfirms.delete(toolCallId);
    pending.resolve(ok);
    return true;
  }

  /** 列出某 session 的待确认 confirm（供 WS 重连恢复 pending confirms）。 */
  getPendingConfirms(sessionId: string): Array<{ toolCallId: string; sessionId: string; question: string }> {
    const out: Array<{ toolCallId: string; sessionId: string; question: string }> = [];
    for (const [toolCallId, pending] of this.pendingConfirms) {
      if (pending.sessionId === sessionId) {
        out.push({ toolCallId, sessionId: pending.sessionId, question: pending.question });
      }
    }
    return out;
  }

  /** 清理所有未完成的 pending ask 与 confirm（run 结束时兜底）。 */
  private cleanupPendingAsks(): void {
    for (const [, pending] of this.pendingAsks) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error('session ended'));
    }
    this.pendingAsks.clear();
    for (const [, pending] of this.pendingConfirms) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.pendingConfirms.clear();
  }

  /**
   * skill 模式处理（/ 菜单触发，会话级持久）。
   * 规则（用户确认的设计）：
   *   - 首次激活：skill 内容（不含元数据）注入系统提示词后（activeSkill.mode='system'）
   *   - 切换 skill：卸载旧注入（system 模式=不再拼接；message 模式=物理删除 skill-inject 消息），
   *     新 skill 内容作为 skill-inject system 消息锚定在本次用户消息后（activeSkill.mode='message'）
   *   - 退出（null）：卸载全部注入
   * 注入/卸载结果通过 skill-mode AgentEvent 推送前端（greet 欢迎语 + icon；不写入 session.messages）。
   */
  private applySkillMode(
    session: Session,
    skillName: string | null,
    onEvent: (event: AgentEvent) => void,
    sessionId: string,
  ): void {
    const prev = session.activeSkill;

    // 1. 卸载旧注入
    if (prev?.mode === 'message') {
      // 物理删除 skill-inject 消息（role=system 且 name=skill-inject）
      session.messages = session.messages.filter(
        m => !(m.role === 'system' && m.name === 'skill-inject'),
      );
    }
    // system 模式的卸载 = activeSkill 置空后 toUnifiedMessages 不再拼接
    session.activeSkill = undefined;

    // 2. 退出模式
    if (skillName === null) {
      onEvent({
        type: 'skill-mode',
        sessionId,
        action: 'exit',
        ...(prev ? { name: prev.name } : {}),
      });
      return;
    }

    // 3. 激活/切换
    const registry = this.services.tryResolve<SkillRegistry>(ServiceNames.SKILL_REGISTRY);
    const skill = registry?.get(skillName);
    if (!registry || !skill || !registry.isEnabled(skillName)) {
      onEvent({
        type: 'skill-mode',
        sessionId,
        action: 'error',
        name: skillName,
        message: `skill "${skillName}" not found or disabled`,
      });
      return;
    }

    if (!prev) {
      // 首次激活：注入系统提示词后
      session.activeSkill = { name: skill.name, mode: 'system', content: skill.prompt };
    } else {
      // 切换：锚定到本次用户消息后（addUserMessage 已执行，append 即紧跟其后）
      session.activeSkill = { name: skill.name, mode: 'message', content: skill.prompt };
      session.messages.push({
        role: 'system',
        content: `# Active Skill: ${skill.name}\n\n${skill.prompt}`,
        name: 'skill-inject',
        timestamp: new Date().toISOString(),
      });
    }

    onEvent({
      type: 'skill-mode',
      sessionId,
      action: prev ? 'switch' : 'enter',
      name: skill.name,
      ...(skill.greet ? { greet: skill.greet } : {}),
      ...(skill.icon ? { icon: skill.icon } : {}),
    });
  }

  /**
   * MCP 工具执行（mcp__server__tool 前缀路径）。
   * 与 executeBuiltinTool 对齐的权限链：
   *   1. server 启用检查（disabled / 未定义 → 拒绝）
   *   2. MCP 工具 annotations 透传：destructiveHint → 用户确认（pendingConfirms）
   *   3. tool:before / tool:after hook
   *   4. 超时保护（config.mcp.callTimeoutMs，默认 120s）
   *   5. elicitation 桥：MCP 服务器向用户请求输入 → ask 机制（answerType=form）
   * structured output 与 resource 完整数据放 metadata（前端可渲染）。
   */
  private async executeMcpTool(
    serverName: string,
    toolName: string,
    args: unknown,
    ctx: {
      sessionId: string;
      cwd: string;
      toolCallId: string;
      onEvent: (event: AgentEvent) => void;
      signal?: AbortSignal;
    },
  ): Promise<ToolResult> {
    const mcpManager = this.services.tryResolve<MCPManager>(ServiceNames.MCP_MANAGER);
    if (!mcpManager) {
      return {
        content: [{ type: 'text', text: 'Error: MCP manager not available' }],
        isError: true,
      };
    }

    // 1. server 启用检查（null=未定义，false=禁用）
    if (mcpManager.isServerEnabled(serverName) !== true) {
      return {
        content: [{ type: 'text', text: `Error: MCP server "${serverName}" is disabled or not found` }],
        isError: true,
      };
    }

    const fullToolName = `mcp__${serverName}__${toolName}`;

    // 2. destructiveHint → 用户确认（与 builtin 工具的 confirm 链一致）
    const annotations = mcpManager.getToolAnnotations(serverName, toolName);
    if (annotations?.destructiveHint === true) {
      const ok = await new Promise<boolean>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingConfirms.delete(ctx.toolCallId);
          resolve(false);
        }, 5 * 60 * 1000);
        this.pendingConfirms.set(ctx.toolCallId, {
          resolve,
          reject,
          timer,
          sessionId: ctx.sessionId,
          question: `[MCP:${serverName}] ${toolName}`,
        });
        if (ctx.signal) {
          ctx.signal.addEventListener(
            'abort',
            () => {
              if (this.pendingConfirms.has(ctx.toolCallId)) {
                clearTimeout(timer);
                this.pendingConfirms.delete(ctx.toolCallId);
                reject(new Error('aborted'));
              }
            },
            { once: true },
          );
        }
        ctx.onEvent({
          type: 'confirm-required',
          sessionId: ctx.sessionId,
          toolCallId: ctx.toolCallId,
          toolName: fullToolName,
          question: t('agent.mcpDestructiveConfirm', { server: serverName, tool: toolName }),
          details: args,
        });
      });
      if (!ok) {
        return {
          content: [{ type: 'text', text: 'Canceled: user declined the destructive MCP tool call' }],
          isError: true,
          metadata: { server: serverName, tool: toolName, canceled: true },
        };
      }
    }

    // 3. tool:before hook
    await this.eventBus.emit('tool:before', {
      name: fullToolName,
      args,
      sessionId: ctx.sessionId,
    });

    // 4. elicitation 桥：MCP 服务器向用户请求输入 → ask 事件（answerType=form + JSON Schema）→ 前端 ElicitationCard
    const elicit = (req: { message: string; requestedSchema?: Record<string, unknown> }) => {
      const question = `[MCP:${serverName}] ${req.message}`;
      const formSchema =
        req.requestedSchema ??
        ({
          type: 'object',
          properties: { message: { type: 'string', description: req.message } },
          required: ['message'],
        } as Record<string, unknown>);
      return new Promise<{ action: 'accept'; content: Record<string, string | number | boolean> } | { action: 'decline' }>(
        (resolve, reject) => {
          // 超时与 ask 工具一致（config.tools.ask.timeoutMinutes；0=永不，兜底 24h ceiling）
          let askTimeoutMs = 0;
          try {
            const askCfg = (this.config.getAppConfig().tools as Record<string, Record<string, unknown>>)?.['ask'];
            const raw = askCfg?.timeoutMinutes;
            if (typeof raw === 'number' && raw > 0) askTimeoutMs = raw * 60 * 1000;
          } catch {
            // config 不可用：永不超时
          }
          const timer = askTimeoutMs > 0 ? setTimeout(() => {
            if (this.pendingAsks.delete(ctx.toolCallId)) {
              resolve({ action: 'decline' });
              ctx.onEvent({ type: 'ask-timeout', sessionId: ctx.sessionId, toolCallId: ctx.toolCallId });
            }
          }, Math.min(askTimeoutMs, ASK_TIMEOUT_CEILING_MS)) : null;
          this.pendingAsks.set(ctx.toolCallId, {
            resolve: outcome => {
              if (outcome.action === 'accept' && outcome.answer?.form) {
                resolve({ action: 'accept', content: outcome.answer.form });
              } else {
                resolve({ action: 'decline' });
              }
            },
            reject,
            timer,
            sessionId: ctx.sessionId,
            payload: { question, answerType: 'form', formSchema },
          });
          if (ctx.signal) {
            ctx.signal.addEventListener(
              'abort',
              () => {
                if (this.pendingAsks.has(ctx.toolCallId)) {
                  if (timer) clearTimeout(timer);
                  this.pendingAsks.delete(ctx.toolCallId);
                  reject(new Error('aborted'));
                }
              },
              { once: true },
            );
          }
          ctx.onEvent({
            type: 'ask',
            sessionId: ctx.sessionId,
            toolCallId: ctx.toolCallId,
            question,
            answerType: 'form',
            formSchema,
          });
        },
      );
    };

    // 5. 调用（超时保护：config.mcp.callTimeoutMs，默认 120s）
    const timeoutMs = this.config.getAppConfig().mcp?.callTimeoutMs ?? 120000;
    let result: Awaited<ReturnType<MCPManager['callTool']>>;
    try {
      result = await mcpManager.callTool(serverName, toolName, args, {
        timeoutMs,
        signal: ctx.signal,
        elicit,
      });
    } catch (err) {
      const errorResult: ToolResult = {
        content: [
          {
            type: 'text',
            text: `Error calling MCP tool ${serverName}/${toolName}: ${err instanceof Error ? err.message : err}`,
          },
        ],
        isError: true,
        metadata: { server: serverName, tool: toolName },
      };
      await this.eventBus.broadcast('tool:after', {
        name: fullToolName,
        args,
        sessionId: ctx.sessionId,
        result: errorResult,
      });
      return errorResult;
    }

    // resource 完整数据收集（metadata 供前端渲染引用卡片）
    const resources = result.content
      .filter((c): c is Extract<typeof c, { type: 'resource' }> => c.type === 'resource')
      .map(c => ({ uri: c.uri, mimeType: c.mimeType, text: c.text, blob: c.blob }));

    const toolResult: ToolResult = {
      content: result.content.map(c => {
        if (c.type === 'text') return { type: 'text' as const, text: c.text };
        if (c.type === 'image') {
          return { type: 'image' as const, source: { data: c.data, mimeType: c.mimeType } };
        }
        // resource：正文给可读摘要（优先 text 内容），完整数据在 metadata.resources
        const resText = c.text ?? `[resource: ${c.uri} (${c.mimeType ?? 'unknown'})]`;
        return { type: 'text' as const, text: resText };
      }),
      isError: result.isError,
      metadata: {
        server: serverName,
        tool: toolName,
        ...(result.structured !== undefined ? { structured: result.structured } : {}),
        ...(resources.length > 0 ? { resources } : {}),
      },
    };

    // tool:after hook
    await this.eventBus.broadcast('tool:after', {
      name: fullToolName,
      args,
      sessionId: ctx.sessionId,
      result: toolResult,
    });

    return toolResult;
  }
}

/**
 * 从 apiConfig.models 反查 model 的显示名（cfg.name）。
 * 先按 id 精确匹配，再按 model 字段（API 模型名）兜底；找不到返回 model 本身。
 */
function resolveModelDisplayName(apiConfig: ApiConfig, model: string): string {
  const byId = apiConfig.models.find(m => m.id === model);
  if (byId) return byId.name;
  const byModel = apiConfig.models.find(m => m.model === model);
  if (byModel) return byModel.name;
  return model;
}
