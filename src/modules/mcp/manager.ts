// src/modules/mcp/manager.ts
// MCP 多服务器生命周期管理。
//
// 服务器定义来源（按优先级合并）：
//   1. ~/.moss/mcps/*.json  （用户实例，每个文件一个 server）
//   2. <packageRoot>/mcps/*.json （默认模板，首次运行时复制到用户目录）
//   3. config.json.mcpServers   （已 deprecated，仅为向后兼容保留；非空时 warn）

import { McpClient, type McpClientEntry, type ServerConfig } from './client';
import type { MCPManager } from '../contracts';
import type { ConfigService, EventBus, Environment, Logger } from '../../core/types';
import { readdir, readFile, stat, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

export class MCPManagerImpl implements MCPManager {
  private readonly entries = new Map<string, McpClientEntry>();
  private readonly config: ConfigService;
  private readonly eventBus: EventBus;
  private readonly logger: Logger;
  private readonly env: Environment;
  /** 当前合并后的服务器定义（按 name 索引） */
  private serverDefs: Map<string, ServerConfig> = new Map();

  constructor(deps: {
    config: ConfigService;
    eventBus: EventBus;
    logger: Logger;
    env: Environment;
  }) {
    this.config = deps.config;
    this.eventBus = deps.eventBus;
    this.logger = deps.logger;
    this.env = deps.env;
  }

  /** 初始化：从 mcps/ 目录与 config.json 加载所有 MCP 服务器并连接 */
  async initialize(): Promise<void> {
    this.serverDefs = await this.loadServerDefs();
    const names = Array.from(this.serverDefs.keys());
    this.logger.info(`MCP manager initializing`, { serverCount: names.length, names });

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

  /**
   * 加载并合并所有服务器定义。
   * 优先级：用户目录 mcps/*.json > 包内模板 mcps/*.json > config.json.mcpServers（deprecated）
   */
  private async loadServerDefs(): Promise<Map<string, ServerConfig>> {
    const defs = new Map<string, ServerConfig>();

    // 1. 包内模板 mcps/*.json
    const builtinDir = join(this.env.packageRoot, 'mcps');
    await this.loadFromDir(defs, builtinDir).catch(() => {});

    // 2. 用户目录 ~/.moss/mcps/*.json（首次运行从包内复制）
    const userDir = join(this.env.dataDir, 'mcps');
    await this.ensureUserMcpsDir(userDir, builtinDir);
    await this.loadFromDir(defs, userDir).catch(() => {});

    // 3. config.json.mcpServers（deprecated，向后兼容）
    const cfg = this.config.getAppConfig();
    const legacyServers = cfg.mcpServers as Record<string, ServerConfig> | undefined;
    if (legacyServers && typeof legacyServers === 'object') {
      const legacyNames = Object.keys(legacyServers);
      if (legacyNames.length > 0) {
        this.logger.warn(
          `config.json "mcpServers" is deprecated, please migrate to ~/.moss/mcps/*.json files. ` +
            `Legacy entries will be merged but may be overridden by directory files.`,
          { legacyNames },
        );
        for (const name of legacyNames) {
          if (!defs.has(name)) {
            defs.set(name, legacyServers[name]);
          }
        }
      }
    }

    return defs;
  }

  /** 从目录加载 *.json 服务器定义文件 */
  private async loadFromDir(defs: Map<string, ServerConfig>, dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const file of entries) {
      if (!file.endsWith('.json')) continue;
      const full = join(dir, file);
      const s = await stat(full).catch(() => null);
      if (!s || !s.isFile()) continue;
      try {
        const raw = await readFile(full, 'utf8');
        const parsed = JSON.parse(raw) as Partial<ServerConfig> & { name?: string };
        // 文件名作为默认 name，但优先使用文件内 name 字段
        const name = parsed.name ?? file.replace(/\.json$/, '');
        if (!parsed.transport) {
          this.logger.warn(`MCP server file ${full} missing "transport" field, skipped`);
          continue;
        }
        defs.set(name, parsed as ServerConfig);
      } catch (err) {
        this.logger.warn(`Failed to parse MCP server file ${full}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /** 确保用户 mcps 目录存在；首次运行时从包内模板复制默认 server 文件 */
  private async ensureUserMcpsDir(userDir: string, builtinDir: string): Promise<void> {
    try {
      await stat(userDir);
      return; // 已存在
    } catch {
      // 不存在，创建
    }
    await mkdir(userDir, { recursive: true }).catch(() => {});
    // 尝试从包内模板复制所有 .json 文件
    let entries: string[] = [];
    try {
      entries = await readdir(builtinDir);
    } catch {
      return;
    }
    for (const file of entries) {
      if (!file.endsWith('.json')) continue;
      const src = join(builtinDir, file);
      const dst = join(userDir, file);
      await copyFile(src, dst).catch(err => {
        this.logger.debug(`Failed to copy default MCP server file ${file}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  async connect(serverName: string): Promise<void> {
    const serverCfg = this.serverDefs.get(serverName);
    if (!serverCfg) {
      throw new Error(
        `MCP server "${serverName}" not found. Check ~/.moss/mcps/${serverName}.json or config.json.mcpServers.`,
      );
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

    this.logger.info(`MCP server "${serverName}" connected`, {
      effectiveTransport: client.getEffectiveTransport(),
    });
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
    // 重新加载定义并连接
    await this.initialize();
  }

  listServers(): Array<{ name: string; status: 'connected' | 'disconnected' | 'error'; toolCount: number }> {
    const result: Array<{ name: string; status: 'connected' | 'disconnected' | 'error'; toolCount: number }> = [];
    // 已连接的
    for (const [name, entry] of this.entries) {
      result.push({
        name,
        status: entry.status,
        toolCount: entry.client.getToolCount(),
      });
    }
    // 已定义但未连接的
    for (const name of this.serverDefs.keys()) {
      if (!this.entries.has(name)) {
        result.push({ name, status: 'disconnected', toolCount: 0 });
      }
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

  /** 关闭所有连接（模组销毁时调用） */
  async shutdown(): Promise<void> {
    const names = Array.from(this.entries.keys());
    await Promise.allSettled(names.map(n => this.disconnect(n).catch(() => {})));
  }
}
