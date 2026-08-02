// src/plugins/server/index.ts
// Server 插件入口：基于 Bun.serve 启动 HTTP + WebSocket 服务。

import type { Plugin, PluginContext, PluginMetadata } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { HttpRouter } from './http-router';
import { WsHandler } from './ws-handler';
import { StaticAssets } from './static-assets';
import type { ServerInstance, Route, WSMessageHandler, WSConnection } from './types';
import { createHealthHandler } from './routes/health';
import {
  createGetAppConfigHandler,
  createUpdateAppConfigHandler,
  createGetApiConfigHandler,
  createUpdateApiConfigHandler,
} from './routes/config';
import { createChatHandler } from './routes/chat';
import {
  createListSessionsHandler,
  createDeleteSessionHandler,
  createSessionHistoryHandler,
} from './routes/session';
import {
  createListMcpServersHandler,
  createListMcpToolsHandler,
  createCallMcpToolHandler,
  createConnectMcpServerHandler,
  createDisconnectMcpServerHandler,
} from './routes/mcp';

interface BunServer {
  stop(): void | Promise<void>;
  upgrade(
    req: Request,
    options?: { data?: unknown; headers?: Record<string, string> },
  ): boolean;
}

interface BunWebSocket {
  send(text: string): void;
  close(): void;
  // 用户数据存储（upgrade 时传入的 data）
  __conn?: WSConnection;
  __id?: string;
}

class ServerPlugin implements Plugin {
  metadata: PluginMetadata = {
    name: 'server',
    version: '1.0.0',
    description: 'HTTP + WebSocket server based on Bun.serve',
  };

  private ctx!: PluginContext;
  private router!: HttpRouter;
  private wsHandler!: WsHandler;
  private assets!: StaticAssets;
  private server: BunServer | null = null;
  private actualPort = 0;
  private actualHost = '127.0.0.1';

  async initialize(ctx: PluginContext): Promise<void> {
    this.ctx = ctx;
    this.assets = new StaticAssets(ctx.env);
    this.router = new HttpRouter(ctx.config, ctx.logger, this.assets);
    this.wsHandler = new WsHandler(ctx.services, ctx.logger);

    this.registerRoutes();

    await this.startServer();

    // 注册 ServerInstance 服务
    const instance: ServerInstance = {
      raw: this.server,
      host: this.actualHost,
      port: this.actualPort,
      baseUrl: `http://${this.actualHost}:${this.actualPort}`,
      addRoute: (route: Route) => this.router.addRoute(route),
      broadcastWS: (msg: unknown) => this.wsHandler.broadcast(msg),
      sendToSession: (sid: string, msg: unknown) => this.wsHandler.sendToSession(sid, msg),
      onWSMessage: (h: WSMessageHandler) => this.wsHandler.onWSMessage(h),
      stop: async () => {
        if (this.server) await this.server.stop();
      },
    };
    ctx.services.register(ServiceNames.SERVER_INSTANCE, instance, { scope: 'server' });

    ctx.logger.info(`Server plugin started at http://${this.actualHost}:${this.actualPort}`, {
      staticAssets: this.assets.isAvailable(),
    });
  }

  async destroy(): Promise<void> {
    if (this.server) {
      await this.server.stop();
      this.ctx.logger.info('Server plugin stopped');
    }
  }

  // ========================================================================

  private registerRoutes(): void {
    const { config, services } = this.ctx;

    this.router.addRoute({ method: 'GET', pattern: '/api/health', handler: createHealthHandler(services), auth: false });

    this.router.addRoute({ method: 'GET', pattern: '/api/config', handler: createGetAppConfigHandler(config), auth: true });
    this.router.addRoute({ method: 'PUT', pattern: '/api/config', handler: createUpdateAppConfigHandler(config), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/api-config', handler: createGetApiConfigHandler(config), auth: true });
    this.router.addRoute({ method: 'PUT', pattern: '/api/api-config', handler: createUpdateApiConfigHandler(config), auth: true });

    this.router.addRoute({ method: 'POST', pattern: '/api/chat', handler: createChatHandler(services), auth: true });

    this.router.addRoute({ method: 'GET', pattern: '/api/session', handler: createListSessionsHandler(services), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/session/:id', handler: createDeleteSessionHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/session/:id', handler: createSessionHistoryHandler(services), auth: true });

    this.router.addRoute({ method: 'GET', pattern: '/api/mcp/servers', handler: createListMcpServersHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/mcp/tools', handler: createListMcpToolsHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/mcp/call', handler: createCallMcpToolHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/mcp/connect', handler: createConnectMcpServerHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/mcp/disconnect', handler: createDisconnectMcpServerHandler(services), auth: true });
  }

  private async startServer(): Promise<void> {
    const cfg = this.ctx.config.getAppConfig();
    let port = cfg.server.port;
    const host = cfg.security.bindLocalhostOnly ? '127.0.0.1' : cfg.server.host;

    if (cfg.server.autoPort) {
      port = await this.findFreePort(host, port);
      if (port !== cfg.server.port) {
        this.ctx.logger.warn(
          `autoPort: configured port ${cfg.server.port} unavailable, using ${port}. ` +
          `If using vite dev proxy (hardcoded to ${cfg.server.port}), WS/HTTP from frontend may fail. ` +
          `Set server.autoPort=false or free port ${cfg.server.port}.`,
        );
      }
    }

    const router = this.router;
    const wsHandler = this.wsHandler;
    const logger = this.ctx.logger;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const BunAny = Bun as any;
    const server: BunServer = BunAny.serve({
      port,
      hostname: host,
      async fetch(req: Request, srv: BunServer): Promise<Response> {
        // WebSocket 升级
        const url = new URL(req.url);
        if (req.headers.get('upgrade') === 'websocket' && (url.pathname === '/ws' || url.pathname === '/ws/')) {
          const connId = crypto.randomUUID();
          const success = srv.upgrade(req, {
            data: { connId },
          });
          if (success) return new Response(null, { status: 101 });
          return new Response('Upgrade failed', { status: 400 });
        }
        // 普通 HTTP 请求
        return handleHttp(req, router, logger);
      },
      websocket: {
        open(ws: BunWebSocket & { data: { connId: string } }) {
          const id = ws.data?.connId ?? crypto.randomUUID();
          const conn: WSConnection = {
            id,
            send: (msg: unknown) => {
              try {
                ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
              } catch {
                // 连接已关闭，忽略
              }
            },
            close: () => {
              try {
                ws.close();
              } catch {
                // 静默
              }
            },
          };
          ws.__conn = conn;
          ws.__id = id;
          wsHandler.registerConnection(conn);
        },
        message(ws: BunWebSocket & { data: { connId: string } }, message: string | Buffer) {
          const id = ws.__id ?? ws.data?.connId;
          if (!id) return;
          const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
          wsHandler.handleMessage(id, text).catch(err => {
            logger.error('WS message handling failed', {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        },
        close(ws: BunWebSocket & { data: { connId: string } }) {
          const id = ws.__id ?? ws.data?.connId;
          if (id) wsHandler.unregisterConnection(id);
        },
      },
    });

    this.server = server;
    this.actualPort = port;
    this.actualHost = host;
  }

  private async findFreePort(host: string, startPort: number): Promise<number> {
    let port = startPort;
    for (let i = 0; i < 100; i++) {
      if (await isPortFree(host, port)) return port;
      port++;
    }
    return startPort;
  }
}

async function isPortFree(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const net = require('node:net');
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

async function handleHttp(
  req: Request,
  router: HttpRouter,
  logger: { debug: (m: string, ctx?: Record<string, unknown>) => void },
): Promise<Response> {
  const url = req.url;
  const method = req.method;
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  const body = req.body ? await req.text() : '';

  logger.debug(`${method} ${url}`);

  const result = await router.handle(method, url, headers, body);
  const respHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...(result.headers ?? {}),
  };

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: respHeaders });
  }

  let responseBody: BodyInit | null = null;
  if (result.body !== undefined && result.body !== null) {
    if (typeof result.body === 'string') {
      responseBody = result.body;
    } else if (result.body instanceof Uint8Array) {
      responseBody = result.body as BodyInit;
    } else if (typeof Buffer !== 'undefined' && result.body instanceof Buffer) {
      responseBody = new Uint8Array(result.body as Buffer) as BodyInit;
    } else {
      responseBody = JSON.stringify(result.body);
    }
  }
  return new Response(responseBody, { status: result.status, headers: respHeaders });
}

export default new ServerPlugin();
