// src/plugins/mcp/manager.ts
// MCP 多服务器生命周期管理。

import { McpClient, type McpClientEntry, type ServerConfig } from './client';
import type { MCPManager } from '../contracts';
import type { ConfigService, EventBus, Logger } from '../../core/types';

export class MCPManagerImpl implements MCPManager {
  private readonly entries = new Map<string, McpClientEntry>();
  private readonly config: ConfigService;
  private readonly eventBus: EventBus;
  private readonly logger: Logger;

  constructor(deps: { config: ConfigService; eventBus: EventBus; logger: Logger }) {
    this.config = deps.config;
    this.eventBus = deps.eventBus;
    this.logger = deps.logger;
  }

  /** 初始化：从配置加载所有 MCP 服务器并连接 */
  async initialize(): Promise<void> {
    const cfg = this.config.getAppConfig();
    const servers = cfg.mcpServers as Record<string, ServerConfig>;
    const names = Object.keys(servers);
    this.logger.info(`MCP manager initializing`, { serverCount: names.length });

    // 并行连接（单服务器失败不影响其他）
    await Promise.allSettled(
      names.map(async name => {
        try {
          await this.connect(name);
        } catch (err) {
          this.logger.error(`MCP server "${name}" connect failed`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }

  async connect(serverName: string): Promise<void> {
    const cfg = this.config.getAppConfig();
    const servers = cfg.mcpServers as Record<string, ServerConfig>;
    const serverCfg = servers[serverName];
    if (!serverCfg) {
      throw new Error(`MCP server "${serverName}" not found in config`);
    }

    // 若已存在，先断开
    const existing = this.entries.get(serverName);
    if (existing) {
      await existing.client.disconnect().catch(() => {});
      this.entries.delete(serverName);
    }

    const client = new McpClient(serverName, serverCfg, this.logger, this.eventBus);
    await client.connect();
    this.entries.set(serverName, {
      client,
      config: serverCfg,
      status: 'connected',
    });

    this.logger.info(`MCP server "${serverName}" connected`);
    await this.eventBus.broadcast('mcp:server:connected', { server: serverName });
  }

  async disconnect(serverName: string): Promise<void> {
    const entry = this.entries.get(serverName);
    if (!entry) {
      this.logger.warn(`MCP server "${serverName}" not connected, cannot disconnect`);
      return;
    }
    await entry.client.disconnect();
    this.entries.delete(serverName);
    this.logger.info(`MCP server "${serverName}" disconnected`);
    await this.eventBus.broadcast('mcp:server:disconnected', { server: serverName });
  }

  async reloadAll(): Promise<void> {
    this.logger.info('Reloading all MCP servers');
    // 断开所有
    const names = Array.from(this.entries.keys());
    await Promise.allSettled(names.map(n => this.disconnect(n).catch(() => {})));
    // 重新连接
    await this.initialize();
  }

  listServers(): Array<{ name: string; status: 'connected' | 'disconnected' | 'error'; toolCount: number }> {
    const result: Array<{ name: string; status: 'connected' | 'disconnected' | 'error'; toolCount: number }> = [];
    for (const [name, entry] of this.entries) {
      result.push({
        name,
        status: entry.status,
        toolCount: entry.client.getToolCount(),
      });
    }
    return result;
  }

  listTools(serverName?: string): Array<{
    server: string;
    name: string;
    description?: string;
    inputSchema?: unknown;
  }> {
    const result: Array<{ server: string; name: string; description?: string; inputSchema?: unknown }> = [];
    const entries = serverName
      ? [[serverName, this.entries.get(serverName)] as const].filter(([, e]) => e !== undefined)
      : Array.from(this.entries.entries());

    for (const [name, entry] of entries) {
      if (!entry || entry.status !== 'connected') continue;
      for (const tool of entry.client.getTools()) {
        result.push({
          server: name,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    }
    return result;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: unknown,
  ): Promise<{
    content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
    isError?: boolean;
  }> {
    const entry = this.entries.get(serverName);
    if (!entry || entry.status !== 'connected') {
      throw new Error(`MCP server "${serverName}" not connected`);
    }
    return await entry.client.callTool(toolName, args);
  }

  /** 关闭所有连接（插件销毁时调用） */
  async shutdown(): Promise<void> {
    const names = Array.from(this.entries.keys());
    await Promise.allSettled(names.map(n => this.disconnect(n).catch(() => {})));
  }
}
