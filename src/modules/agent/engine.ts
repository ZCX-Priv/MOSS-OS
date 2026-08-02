// src/plugins/agent/engine.ts
// Agent ReAct 循环引擎。

import { buildSystemPrompt, buildTools } from './context';
import { SessionStore } from './session';
import { LLMError, type UnifiedRequest } from '../llm/types';
import type { AgentMessage, AgentEngine, AgentEvent, AgentRunInput, AgentRunResult } from '../contracts';
import type { LLMRouter, ToolRegistry, MCPManager } from '../contracts';
import type { ConfigService, EventBus, Logger, ServiceRegistry, Environment, ApiConfig } from '../../core/types';
import { ServiceNames } from '../../core/types';
import type { ToolResult } from '../tools/types';

export class AgentEngineImpl implements AgentEngine {
  private readonly sessions: SessionStore;
  private readonly services: ServiceRegistry;
  private readonly config: ConfigService;
  private readonly eventBus: EventBus;
  private readonly logger: Logger;
  private readonly env: Environment;

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
    this.sessions = new SessionStore(deps.logger);
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const { sessionId, userMessage, cwd, onEvent, signal } = input;
    const cfg = this.config.getAppConfig().agent;
    const model = input.model ?? cfg.defaultModel;
    const provider = input.provider;

    this.logger.info(`Agent run start`, { sessionId, model, provider });

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
      this.logger.warn('Failed to list MCP tools', {
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
        for await (const delta of llm.stream(req, provider)) {
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
              const existing = toolCallAccumulators.get(delta.index) ?? {
                id: delta.toolCallId,
                name: delta.name,
                args: '',
              };
              if (delta.toolCallId) existing.id = delta.toolCallId;
              if (delta.name) existing.name = delta.name;
              existing.args += delta.argumentsDelta;
              toolCallAccumulators.set(delta.index, existing);
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
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error('LLM stream failed', { error: msg, turn });
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
          finishReason = 'aborted';
          break;
        }
        await this.executeToolCall(tc, {
          sessionId,
          cwd,
          toolCallId: tc.id,
          onEvent,
          signal,
        });
      }

      if (finishReason === 'aborted') break;

      // 继续下一轮（让 LLM 看到工具结果后继续）
      finalText = assistantText;
    }

    if (turn >= maxTurns && finishReason === 'stop') {
      this.logger.warn(`Agent reached max turns (${maxTurns})`, { sessionId });
      finishReason = 'length';
    }

    onEvent({ type: 'done', sessionId, finishReason });

    this.logger.info(`Agent run complete`, { sessionId, turn, finishReason });

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

  /** 删除会话 */
  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
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

    onEvent({
      type: 'tool-call-start',
      sessionId,
      toolName: tc.name,
      toolCallId,
      args: tc.arguments,
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

    if (mcpMatch) {
      result = await this.executeMcpTool(mcpMatch[1], mcpMatch[2], args, ctx);
    } else {
      result = await this.executeBuiltinTool(tc.name, args, ctx);
    }

    // 记录工具结果到会话
    const resultText = result.content
      .map(c => (c.type === 'text' ? c.text : `[image: ${c.source.mimeType}]`))
      .join('\n');
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
        }
      },
      logger: this.logger,
      services: this.services,
      signal: ctx.signal,
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
          return { type: 'image' as const, source: { data: c.data, mimeType: c.mimeType } };
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
 * 从 apiConfig 反查 model 所属 provider，返回 `${providerName}/${model}` 作为可读模型名。
 * 找不到匹配的 provider 则返回 model 本身。
 */
function resolveModelDisplayName(apiConfig: ApiConfig, model: string): string {
  for (const [providerName, provider] of Object.entries(apiConfig.providers)) {
    if (provider.models.includes(model)) {
      return `${providerName}/${model}`;
    }
  }
  return model;
}
