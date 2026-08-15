// src/modules/mcp/expose.ts
// MOSS 对外 MCP Server 暴露（/mcp 端点，Streamable HTTP 无状态模式）。
//
// 由 config.mcpServer.enabled 控制（默认关闭）；复用主端口的 authToken Bearer 鉴权。
// 暴露范围：config.mcpServer.allowedTools 白名单（空数组 = 全部启用工具，
// 但 requireConfirmation 工具默认排除——外部客户端无确认通道，避免破坏性操作裸奔；
// 显式加入白名单才暴露）。
//
// 采用 SDK 低层 Server API（setRequestHandler），inputSchema 直接使用 MOSS 的
// JSON Schema（McpServer.registerTool 需要 zod，低层 API 无此限制）。

import type { ConfigService, Logger, ServiceRegistry } from '../../core/types';
import { ServiceNames } from '../../core/types';
import type { ToolRegistry } from '../contracts';
import type { ToolContext, ToolResult } from '../tools/types';

/** 最小化 SDK 类型契约（动态 import，避免版本差异） */
interface SdkServer {
  setRequestHandler(schema: unknown, handler: (req: unknown) => Promise<unknown>): void;
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
}

interface SdkTransport {
  onclose?: () => void;
  onerror?: (err: unknown) => void;
  handleRequest(req: Request): Promise<Response>;
}

export class McpExpose {
  private readonly config: ConfigService;
  private readonly services: ServiceRegistry;
  private readonly logger: Logger;

  constructor(deps: {
    config: ConfigService;
    services: ServiceRegistry;
    logger: Logger;
  }) {
    this.config = deps.config;
    this.services = deps.services;
    this.logger = deps.logger;
  }

  /** 当前是否启用对外暴露（实时读 config，热更新生效） */
  isEnabled(): boolean {
    return this.config.getAppConfig().mcpServer?.enabled === true;
  }

  /** authToken 鉴权（与 http-router 逻辑一致：未设置 token 时不鉴权） */
  private checkAuth(req: Request): boolean {
    const cfg = this.config.getAppConfig();
    if (!cfg.security.authToken) return true;
    const auth = req.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
    return token === cfg.security.authToken;
  }

  /**
   * 处理 /mcp 端点请求。返回 null 表示路径不匹配（由调用方继续常规处理）。
   * 未启用时返回 404（不暴露端点存在性）。
   */
  async handleRequest(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (url.pathname !== '/mcp' && url.pathname !== '/mcp/') return null;

    if (!this.isEnabled()) {
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!this.checkAuth(req)) {
      return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer',
        },
      });
    }

    const method = req.method;
    // 无状态模式：不支持 GET（SSE 流）与 DELETE（会话终止）
    if (method !== 'POST') {
      return new Response(null, {
        status: 405,
        headers: { Allow: 'POST' },
      });
    }

    try {
      return await this.handlePost(req);
    } catch (err) {
      this.logger.warn('mcp expose request failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  /** POST：无状态模式，每请求新建 transport + server（SDK 推荐做法） */
  private async handlePost(req: Request): Promise<Response> {
    // 动态 import（SDK 缺失时不影响主流程）
    const { Server } = (await import('@modelcontextprotocol/sdk/server/index.js')) as {
      Server: new (info: unknown, opts: unknown) => SdkServer;
    };
    const { WebStandardStreamableHTTPServerTransport } = (await import(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js' as any
    )) as {
      WebStandardStreamableHTTPServerTransport: new (opts: unknown) => SdkTransport;
    };
    const { ListToolsRequestSchema, CallToolRequestSchema } = (await import(
      '@modelcontextprotocol/sdk/types.js'
    )) as { ListToolsRequestSchema: unknown; CallToolRequestSchema: unknown };

    const registry = this.services.tryResolve<ToolRegistry>(ServiceNames.TOOL_REGISTRY);
    if (!registry) {
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Tool registry unavailable' }, id: null }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // 无状态：sessionIdGenerator 显式 undefined（不维持会话）
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const server = new Server(
      { name: 'moss', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    this.registerHandlers(server, registry, { ListToolsRequestSchema, CallToolRequestSchema });

    try {
      await server.connect(transport);
      return await transport.handleRequest(req);
    } finally {
      // 请求结束即关闭（无状态，不保留任何会话资源）
      transport.onclose?.();
      await server.close().catch(() => {});
    }
  }

  /** 注册 ListTools / CallTool handler（inputSchema 直接用 MOSS 的 JSON Schema） */
  private registerHandlers(
    server: SdkServer,
    registry: ToolRegistry,
    schemas: { ListToolsRequestSchema: unknown; CallToolRequestSchema: unknown },
  ): void {
    const exposeTools = this.filterTools(registry);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server.setRequestHandler(schemas.ListToolsRequestSchema, async () => ({
      tools: exposeTools.map(tool => ({
        name: tool.name,
        title: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.annotations
          ? {
              annotations: {
                ...(tool.annotations.readOnlyHint !== undefined
                  ? { readOnlyHint: tool.annotations.readOnlyHint }
                  : {}),
                ...(tool.annotations.destructiveHint !== undefined
                  ? { destructiveHint: tool.annotations.destructiveHint }
                  : {}),
                ...(tool.annotations.idempotentHint !== undefined
                  ? { idempotentHint: tool.annotations.idempotentHint }
                  : {}),
              },
            }
          : {}),
      })),
    }));

    server.setRequestHandler(schemas.CallToolRequestSchema, async req => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { name, arguments: args } = (req as any).params as {
        name: string;
        arguments?: Record<string, unknown>;
      };
      const tool = exposeTools.find(t => t.name === name);
      if (!tool) {
        return {
          content: [{ type: 'text', text: `Error: tool "${String(name)}" not exposed` }],
          isError: true,
        };
      }
      // 对外执行 ctx：无 confirm / askUser（requireConfirmation 工具已在过滤阶段排除）
      const ctx: ToolContext = {
        sessionId: 'mcp-external',
        cwd: process.cwd(),
        toolCallId: `mcp-exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        emit: () => {
          // 外部通道无进度事件转发
        },
        logger: this.logger,
        services: this.services,
      };
      try {
        const result: ToolResult = await registry.execute(name, args ?? {}, ctx);
        return this.toCallToolResult(result);
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` },
          ],
          isError: true,
        };
      }
    });
  }

  /** 按白名单/确认要求过滤可暴露工具 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private filterTools(registry: ToolRegistry): Array<{ name: string; description: string; inputSchema: unknown; annotations?: any }> {
    const cfg = this.config.getAppConfig();
    const allowed = cfg.mcpServer?.allowedTools ?? [];
    const toolsCfg = cfg.tools as Record<string, { requireConfirmation?: boolean }> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: Array<{ name: string; description: string; inputSchema: unknown; annotations?: any }> = [];
    for (const tool of registry.list()) {
      if (!registry.isEnabled(tool.name)) continue;
      const inWhitelist = allowed.includes(tool.name);
      if (allowed.length > 0 && !inWhitelist) continue; // 白名单非空：仅白名单
      // 白名单为空：排除 requireConfirmation 工具（无确认通道）
      const requireConfirm =
        tool.annotations?.requireConfirmation === true ||
        toolsCfg?.[tool.name]?.requireConfirmation === true;
      if (allowed.length === 0 && requireConfirm) continue;
      out.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      });
    }
    return out;
  }

  /** ToolResult → SDK CallToolResult（text/image/structured） */
  private toCallToolResult(result: ToolResult): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = result.content.map((c: any): Record<string, any> => {
      if (c.type === 'text') return { type: 'text', text: c.text };
      return { type: 'image', data: c.source.data, mimeType: c.source.mimeType };
    });
    const structured = (result.metadata as { structured?: unknown } | undefined)?.structured;
    return {
      content,
      ...(result.isError ? { isError: true } : {}),
      ...(structured !== undefined && structured !== null
        ? { structuredContent: structured }
        : {}),
    };
  }
}
