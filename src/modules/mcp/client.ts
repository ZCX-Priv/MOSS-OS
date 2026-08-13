// src/modules/mcp/client.ts
// 单服务器 MCP Client 封装：动态 import @modelcontextprotocol/sdk。
//
// 支持三种传输：
//   - stdio  (StdioClientTransport)
//   - http   (StreamableHTTPClientTransport, 2025-03-26 新标准)
//   - sse    (SSEClientTransport, 旧标准)
// 当 http 连接失败时，自动回退到 sse 重试一次（兼容旧 MCP server）。
//
// SDK 入口分布：
//   - Client                                @modelcontextprotocol/sdk/client
//   - StdioClientTransport                  @modelcontextprotocol/sdk/client/stdio
//   - StreamableHTTPClientTransport         @modelcontextprotocol/sdk/client/streamableHttp
//   - SSEClientTransport                    @modelcontextprotocol/sdk/client/sse

import { t } from '../../core/i18n';
import type { EventBus, Logger } from '../../core/types';

// ============================================================================
// 类型定义
// ============================================================================

export interface ServerConfig {
  /** 传输类型：stdio | http | sse */
  transport: 'stdio' | 'http' | 'sse';
  /** stdio: 命令；http/sse: URL */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  /** 自定义请求头（http / sse 传输） */
  headers?: Record<string, string>;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpToolResult {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: 'resource'; uri: string; mimeType?: string; text?: string; blob?: string }
  >;
  isError?: boolean;
}

export interface McpClientEntry {
  client: McpClient;
  config: ServerConfig;
  status: 'connected' | 'disconnected' | 'error';
}

// ============================================================================
// MCP SDK 客户端的最小化类型契约
// ----------------------------------------------------------------------------
// 不直接依赖 SDK 类型（避免版本差异），定义与 SDK Client 行为兼容的最小接口。
// ============================================================================

interface McpSdkClient {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }>;
  callTool(req: { name: string; arguments?: Record<string, unknown> }): Promise<{
    content?: Array<{ type: string; text?: string; data?: string; mimeType?: string; uri?: string; blob?: string }>;
    isError?: boolean;
  }>;
}

interface McpSdkTransport {
  // 仅作占位，具体构造由 SDK 完成
}

interface McpSdkModule {
  Client?: new (info: { name: string; version: string }, opts: { capabilities: Record<string, unknown> }) => McpSdkClient;
  StdioClientTransport?: new (opts: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }) => McpSdkTransport;
  StreamableHTTPClientTransport?: new (
    url: URL,
    opts?: { requestInit?: { headers?: Record<string, string> } },
  ) => McpSdkTransport;
  SSEClientTransport?: new (
    url: URL,
    opts?: { requestInit?: { headers?: Record<string, string> } },
  ) => McpSdkTransport;
}

// ============================================================================
// McpClient
// ============================================================================

export class McpClient {
  private sdkClient: McpSdkClient | null = null;
  private tools: McpToolInfo[] = [];
  private readonly name: string;
  private readonly config: ServerConfig;
  private readonly logger: Logger;
  private readonly eventBus: EventBus;
  /** 实际使用的传输（http 可能回退为 sse） */
  private effectiveTransport: 'stdio' | 'http' | 'sse' | null = null;

  constructor(name: string, config: ServerConfig, logger: Logger, eventBus: EventBus) {
    this.name = name;
    this.config = config;
    this.logger = logger;
    this.eventBus = eventBus;
  }

  async connect(): Promise<void> {
    // 分别从子路径动态 import（SDK 不存在根 index.js）
    const clientMod = (await import('@modelcontextprotocol/sdk/client')) as McpSdkModule;
    const Client = clientMod.Client;
    if (!Client) {
      throw new Error(t('mcp.sdkClientNotFound'));
    }

    let transport: McpSdkTransport;
    if (this.config.transport === 'stdio') {
      transport = await this.createStdioTransport();
      this.effectiveTransport = 'stdio';
    } else if (this.config.transport === 'http') {
      // 尝试新标准 StreamableHTTP，失败则自动回退到 SSE
      try {
        transport = await this.createHttpTransport();
        this.effectiveTransport = 'http';
      } catch (err) {
        this.logger.warn(t('mcp.httpFallbackSse', { name: this.name }), {
          error: err instanceof Error ? err.message : String(err),
        });
        transport = await this.createSseTransport();
        this.effectiveTransport = 'sse';
      }
    } else if (this.config.transport === 'sse') {
      transport = await this.createSseTransport();
      this.effectiveTransport = 'sse';
    } else {
      throw new Error(t('mcp.unknownTransport', { transport: this.config.transport }));
    }

    // 创建 client 实例
    this.sdkClient = new Client(
      { name: 'moss', version: '1.0.0' },
      { capabilities: {} },
    );

    // 连接（http 若失败也尝试回退 SSE）
    try {
      await this.sdkClient.connect(transport);
    } catch (err) {
      if (this.config.transport === 'http' && this.effectiveTransport === 'http') {
        // http connect 失败，回退 SSE
        this.logger.warn(t('mcp.httpConnectFailedRetrySse', { name: this.name }), {
          error: err instanceof Error ? err.message : String(err),
        });
        await this.sdkClient.close().catch(() => {});
        this.sdkClient = null;
        transport = await this.createSseTransport();
        this.effectiveTransport = 'sse';
        this.sdkClient = new Client(
          { name: 'moss', version: '1.0.0' },
          { capabilities: {} },
        );
        await this.sdkClient.connect(transport);
      } else {
        throw err;
      }
    }

    this.logger.info(t('mcp.clientConnected', { name: this.name }), {
      transport: this.config.transport,
      effective: this.effectiveTransport,
    });

    // 列出工具
    await this.refreshTools();
  }

  async disconnect(): Promise<void> {
    if (this.sdkClient) {
      try {
        await this.sdkClient.close();
      } catch {
        // 静默
      }
      this.sdkClient = null;
      this.tools = [];
      this.effectiveTransport = null;
    }
  }

  getTools(): McpToolInfo[] {
    return this.tools;
  }

  getToolCount(): number {
    return this.tools.length;
  }

  getEffectiveTransport(): 'stdio' | 'http' | 'sse' | null {
    return this.effectiveTransport;
  }

  async refreshTools(): Promise<void> {
    if (!this.sdkClient) return;
    try {
      const result = await this.sdkClient.listTools();
      this.tools = (result.tools ?? []).map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      this.logger.debug(t('mcp.toolsRefreshed', { name: this.name }), { count: this.tools.length });
    } catch (err) {
      this.logger.warn(t('mcp.listToolsFailed', { name: this.name }), {
        error: err instanceof Error ? err.message : String(err),
      });
      this.tools = [];
    }
  }

  async callTool(toolName: string, args: unknown): Promise<McpToolResult> {
    if (!this.sdkClient) {
      throw new Error(t('mcp.clientNotConnected', { name: this.name }));
    }
    const result = await this.sdkClient.callTool({
      name: toolName,
      arguments: args as Record<string, unknown>,
    });

    // 归一化结果
    const content: McpToolResult['content'] = [];
    if (Array.isArray(result.content)) {
      for (const part of result.content) {
        if (part.type === 'text') {
          content.push({ type: 'text', text: part.text ?? '' });
        } else if (part.type === 'image') {
          content.push({
            type: 'image',
            data: part.data ?? '',
            mimeType: part.mimeType ?? 'image/png',
          });
        } else if (part.type === 'resource') {
          // MCP resource 类型：保留 uri/mimeType/text/blob 字段，不再静默丢弃
          content.push({
            type: 'resource',
            uri: part.uri ?? '',
            mimeType: part.mimeType,
            text: part.text,
            blob: part.blob,
          });
        }
      }
    }
    return {
      content,
      isError: result.isError ?? false,
    };
  }

  // ========================================================================
  // 传输构造
  // ========================================================================

  private async createStdioTransport(): Promise<McpSdkTransport> {
    const stdioMod = (await import('@modelcontextprotocol/sdk/client/stdio')) as McpSdkModule;
    const StdioTransport = stdioMod.StdioClientTransport;
    if (!StdioTransport) throw new Error(t('mcp.stdioTransportNotFound'));
    if (!this.config.command) throw new Error(t('mcp.stdioRequiresCommand'));
    // 合并环境变量：继承当前进程 + 用户配置 + UTF-8 引导（避免子进程 GBK 输出乱码）
    const env = {
      ...process.env,
      ...this.config.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    } as Record<string, string>;
    if (process.platform !== 'win32') {
      env.LANG = env.LANG ?? 'zh_CN.UTF-8';
      env.LC_ALL = env.LC_ALL ?? 'zh_CN.UTF-8';
    }
    return new StdioTransport({
      command: this.config.command,
      args: this.config.args ?? [],
      env,
    });
  }

  private async createHttpTransport(): Promise<McpSdkTransport> {
    const httpMod = (await import('@modelcontextprotocol/sdk/client/streamableHttp')) as McpSdkModule;
    const HttpTransport = httpMod.StreamableHTTPClientTransport;
    if (!HttpTransport) throw new Error(t('mcp.httpTransportNotFound'));
    if (!this.config.url) throw new Error(t('mcp.httpRequiresUrl'));
    return new HttpTransport(new URL(this.config.url), {
      requestInit: { headers: this.config.headers },
    });
  }

  private async createSseTransport(): Promise<McpSdkTransport> {
    const sseMod = (await import('@modelcontextprotocol/sdk/client/sse')) as McpSdkModule;
    const SseTransport = sseMod.SSEClientTransport;
    if (!SseTransport) throw new Error(t('mcp.sseTransportNotFound'));
    if (!this.config.url) throw new Error(t('mcp.sseRequiresUrl'));
    return new SseTransport(new URL(this.config.url), {
      requestInit: { headers: this.config.headers },
    });
  }
}
