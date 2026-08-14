// src/plugins/agent/engine.ts
// Agent ReAct 循环引擎。

import { t } from '../../core/i18n';
import { buildSystemPrompt, buildTools } from './context';
import { SessionStore, type ContextFile } from './session';
import { TaskStore, type TaskItem, type TaskGroup } from './task-store';
import { LLMError, type UnifiedRequest } from '../llm/types';
import type { AgentMessage, AgentEngine, AgentEvent, AgentRunInput, AgentRunResult } from '../contracts';
import type { LLMRouter, ToolRegistry, MCPManager } from '../contracts';
import type { ConfigService, EventBus, Logger, ServiceRegistry, Environment, ApiConfig } from '../../core/types';
import { ServiceNames } from '../../core/types';
import type { ToolResult } from '../tools/types';
import { getTodoStorePath, readTodoStore } from '../tools/todo';

export class AgentEngineImpl implements AgentEngine {
  private readonly sessions: SessionStore;
  private readonly tasks: TaskStore;
  private readonly services: ServiceRegistry;
  private readonly config: ConfigService;
  private readonly eventBus: EventBus;
  private readonly logger: Logger;
  private readonly env: Environment;
  /** pending ask 调用：toolCallId -> { resolve, reject, timer, sessionId, question } */
  private readonly pendingAsks = new Map<string, {
    resolve: (answer: string) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    sessionId: string;
    question: string;
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

  /** 获取会话历史 */
  getHistory(sessionId: string): AgentMessage[] {
    return this.sessions.get(sessionId)?.messages ?? [];
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
    // session 复用时触发 Anthropic HTTP 400。
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
   * - todo 工具：推送 todo-updated
   * - read/edit/write/grep/glob：更新 contextFiles 轨迹并推送 context-updated
   * - write：额外推送 file-created
   * - edit：额外推送 file-edited
   * server 模组未加载时静默跳过，不阻断工具执行。
   */
  private notifyToolSideEffects(toolName: string, args: unknown, sessionId: string, toolCallId: string): void {
    const server = this.services.tryResolve<{
      sendToSession: (sid: string, msg: unknown) => void;
    }>(ServiceNames.SERVER_INSTANCE);
    if (!server) return;

    try {
      switch (toolName) {
        case 'todo': {
          const store = readTodoStore(getTodoStorePath(this.env));
          const todos = store.items.filter((it) => it.sessionId === sessionId);
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
        case 'edit':
        case 'write':
        case 'grep':
        case 'glob': {
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
          if (toolName === 'write') {
            server.sendToSession(sessionId, {
              type: 'file-created',
              sessionId,
              payload: { path },
            });
          } else if (toolName === 'edit') {
            server.sendToSession(sessionId, {
              type: 'file-edited',
              sessionId,
              payload: { path },
            });
          }
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
      askUser: (question: string) => {
        return new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pendingAsks.delete(ctx.toolCallId);
            reject(new Error('ask timeout (5min)'));
          }, 5 * 60 * 1000);
          this.pendingAsks.set(ctx.toolCallId, {
            resolve,
            reject,
            timer,
            sessionId: ctx.sessionId,
            question,
          });
          // 中断时立即 reject
          if (ctx.signal) {
            ctx.signal.addEventListener(
              'abort',
              () => {
                if (this.pendingAsks.has(ctx.toolCallId)) {
                  clearTimeout(timer);
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

  /** 前端回复 ask 提问。匹配到 pending 则 resolve 并返回 true。 */
  resolveAsk(toolCallId: string, answer: string): boolean {
    const pending = this.pendingAsks.get(toolCallId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingAsks.delete(toolCallId);
    pending.resolve(answer);
    return true;
  }

  /** 列出某 session 的待答 ask（供 WS 重连恢复 pending asks）。 */
  getPendingAsks(sessionId: string): Array<{ toolCallId: string; sessionId: string; question: string }> {
    const out: Array<{ toolCallId: string; sessionId: string; question: string }> = [];
    for (const [toolCallId, pending] of this.pendingAsks) {
      if (pending.sessionId === sessionId) {
        out.push({ toolCallId, sessionId: pending.sessionId, question: pending.question });
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
      clearTimeout(pending.timer);
      pending.reject(new Error('session ended'));
    }
    this.pendingAsks.clear();
    for (const [, pending] of this.pendingConfirms) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.pendingConfirms.clear();
  }

  private async executeMcpTool(
    serverName: string,
    toolName: string,
    args: unknown,
    ctx: {
      sessionId: string;
      onEvent: (event: AgentEvent) => void;
    },
  ): Promise<ToolResult> {
    const mcpManager = this.services.tryResolve<MCPManager>(ServiceNames.MCP_MANAGER);
    if (!mcpManager) {
      return {
        content: [{ type: 'text', text: 'Error: MCP manager not available' }],
        isError: true,
      };
    }

    try {
      const result = await mcpManager.callTool(serverName, toolName, args);
      return {
        content: result.content.map(c => {
          if (c.type === 'text') return { type: 'text' as const, text: c.text };
          if (c.type === 'image') {
            return { type: 'image' as const, source: { data: c.data, mimeType: c.mimeType } };
          }
          // resource: 优先用 text 字段，否则生成占位符（无法映射为 image source 结构）
          const resText = c.text ?? `[resource: ${c.uri} (${c.mimeType ?? 'unknown'})]`;
          return { type: 'text' as const, text: resText };
        }),
        isError: result.isError,
        metadata: { server: serverName, tool: toolName },
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `Error calling MCP tool ${serverName}/${toolName}: ${err instanceof Error ? err.message : err}`,
          },
        ],
        isError: true,
      };
    }
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
