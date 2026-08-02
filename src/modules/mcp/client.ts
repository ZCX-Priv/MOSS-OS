// src/plugins/mcp/client.ts
// 单服务器 MCP Client 封装：动态 import @modelcontextprotocol/sdk。
//
// SDK 1.30+ 的入口分布：
//   - Client                           @modelcontextprotocol/sdk/client
//   - StdioClientTransport             @modelcontextprotocol/sdk/client/stdio
//   - StreamableHTTPClientTransport    @modelcontextprotocol/sdk/client/streamableHttp
// 由于 SDK 不存在根 index.js（package.json "." 子路径指向的文件缺失），
// 必须按子路径分别 import。这里用动态 import 拆分以避免顶层依赖。

import type { EventBus, Logger } from '../../core/types';

// ============================================================================
// 类型定义
// ============================================================================

export interface ServerConfig {
  /** 传输类型：stdio 或 http */
  transport: 'stdio' | 'http';
  /** stdio: 命令；http: URL */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  /** 自定义请求头（http 传输） */
  headers?: Record<string, string>;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
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
// 我们不直接依赖 SDK 的类型（避免版本差异导致类型不兼容），而是定义一个
// 与 SDK Client 行为兼容的最小接口。这样动态 import 后 cast 到此接口即可。
// ============================================================================

interface McpSdkClient {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }>;
  callTool(req: { name: string; arguments?: Record<string, unknown> }): Promise<{
    content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
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
      throw new Error('MCP SDK Client not found in @modelcontextprotocol/sdk/client');
    }

    let transport: McpSdkTransport;
    if (this.config.transport === 'stdio') {
      const stdioMod = (await import('@modelcontextprotocol/sdk/client/stdio')) as McpSdkModule;
      const StdioTransport = stdioMod.StdioClientTransport;
      if (!StdioTransport) throw new Error('StdioClientTransport not available in MCP SDK');
      if (!this.config.command) throw new Error('stdio transport requires "command"');
      transport = new StdioTransport({
        command: this.config.command,
        args: this.config.args ?? [],
        env: this.config.env,
      });
    } else if (this.config.transport === 'http') {
      const httpMod = (await import('@modelcontextprotocol/sdk/client/streamableHttp')) as McpSdkModule;
      const HttpTransport = httpMod.StreamableHTTPClientTransport;
      if (!HttpTransport) throw new Error('StreamableHTTPClientTransport not available in MCP SDK');
      if (!this.config.url) throw new Error('http transport requires "url"');
      transport = new HttpTransport(new URL(this.config.url), {
        requestInit: { headers: this.config.headers },
      });
    } else {
      throw new Error(`Unknown transport: ${this.config.transport}`);
    }

    // 创建 client 实例
    this.sdkClient = new Client(
      { name: 'moss-os', version: '1.0.0' },
      { capabilities: {} },
    );

    // 连接
    await this.sdkClient.connect(transport);
    this.logger.info(`MCP client "${this.name}" connected`, { transport: this.config.transport });

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
    }
  }

  getTools(): McpToolInfo[] {
    return this.tools;
  }

  getToolCount(): number {
    return this.tools.length;
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
      this.logger.debug(`MCP "${this.name}" tools refreshed`, { count: this.tools.length });
    } catch (err) {
      this.logger.warn(`MCP "${this.name}" listTools failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
      this.tools = [];
    }
  }

  async callTool(toolName: string, args: unknown): Promise<McpToolResult> {
    if (!this.sdkClient) {
      throw new Error(`MCP client "${this.name}" not connected`);
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
        }
      }
    }
    return {
      content,
      isError: result.isError ?? false,
    };
  }
}
