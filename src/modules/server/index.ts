// src/modules/server/index.ts
// Server 模组入口：基于 Bun.serve 启动 HTTP + WebSocket 服务。
// 清单来自 module.json，由 ExtensionManager 注入 manifest。

import { t } from '../../core/i18n';
import type { Module, ModuleContext, ModuleManifest } from '../../core/types';
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
import { createListSkillsHandler, createGetSkillHandler } from './routes/skills';
import { createSpecsHandler } from './routes/specs';
import { createListToolsHandler, createUpdateToolHandler } from './routes/tools';
import { createVersionHandler } from './routes/version';
import {
  createListModelsHandler,
  createSetCurrentModelHandler,
  createCreateModelHandler,
  createUpdateModelHandler,
  createDeleteModelHandler,
  createTestModelHandler,
  createReorderModelsHandler,
} from './routes/models';
import { createListTodosHandler, createReplaceTodosHandler } from './routes/todos';
import { createSessionContextHandler } from './routes/session-context';
import {
  createListTasksHandler,
  createCreateTaskHandler,
  createGetTaskHandler,
  createUpdateTaskHandler,
  createDeleteTaskHandler,
  createReorderTasksHandler,
  createListTaskGroupsHandler,
  createCreateTaskGroupHandler,
  createUpdateTaskGroupHandler,
  createDeleteTaskGroupHandler,
} from './routes/tasks';
import { createSearchHandler } from './routes/search';
import {
  createListAgentsHandler,
  createCreateAgentHandler,
  createGetAgentHandler,
  createUpdateAgentHandler,
  createDeleteAgentHandler,
  createSetDefaultAgentHandler,
} from './routes/agents';
import { createListAutomationsHandler,
  createCreateAutomationHandler,
  createGetAutomationHandler,
  createUpdateAutomationHandler,
  createDeleteAutomationHandler,
  createTriggerAutomationHandler,
  createPauseAutomationHandler,
  createResumeAutomationHandler,
  createAutomationHistoryHandler,
  createListAutomationTemplatesHandler,
} from './routes/automations';
import {
  createListPluginsHandler,
  createGetPluginHandler,
  createUpdatePluginHandler,
} from './routes/plugins';
import {
  createResolveDirectoryHandler,
  createSuggestPathsHandler,
  createPickDirectoryHandler,
} from './routes/filesystem';

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

class ServerModule implements Module {
  manifest!: ModuleManifest; // 由管理器注入

  private ctx!: ModuleContext;
  private router!: HttpRouter;
  private wsHandler!: WsHandler;
  private assets!: StaticAssets;
  private server: BunServer | null = null;
  private actualPort = 0;
  private actualHost = '127.0.0.1';

  async initialize(ctx: ModuleContext): Promise<void> {
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
    ctx.services.register(ServiceNames.SERVER_INSTANCE, instance, {
      scope: 'server',
      registrantType: 'module',
    });

    // 阶段5.3：订阅 config:changed 事件，转发为 WS config.changed
    // 阶段5.4：订阅 extension:changed 事件，转发为 WS extension.changed
    // 通过 EventBus 解耦，避免 config-service / kernel 直接依赖 server.instance（循环依赖）
    ctx.eventBus.onAction('config:changed', (data) => {
      this.wsHandler.broadcast({ type: 'config.changed', payload: data });
    });
    ctx.eventBus.onAction('extension:changed', (data) => {
      this.wsHandler.broadcast({ type: 'extension.changed', payload: data });
    });

    ctx.logger.info(t('server.started', { host: this.actualHost, port: this.actualPort }), {
      staticAssets: this.assets.isAvailable(),
    });
  }

  async destroy(): Promise<void> {
    if (this.server) {
      await this.server.stop();
      this.ctx.logger.info(t('server.stopped'));
    }
  }

  // ========================================================================

  private registerRoutes(): void {
    const { config, services, env } = this.ctx;

    this.router.addRoute({ method: 'GET', pattern: '/api/health', handler: createHealthHandler(services), auth: false });
    this.router.addRoute({ method: 'GET', pattern: '/api/version', handler: createVersionHandler(env), auth: false });

    this.router.addRoute({ method: 'GET', pattern: '/api/config', handler: createGetAppConfigHandler(config), auth: true });
    this.router.addRoute({ method: 'PUT', pattern: '/api/config', handler: createUpdateAppConfigHandler(config), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/api-config', handler: createGetApiConfigHandler(config), auth: true });
    this.router.addRoute({ method: 'PUT', pattern: '/api/api-config', handler: createUpdateApiConfigHandler(config), auth: true });

    this.router.addRoute({ method: 'GET', pattern: '/api/session', handler: createListSessionsHandler(services), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/session/:id', handler: createDeleteSessionHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/session/:id', handler: createSessionHistoryHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/sessions/:id/context', handler: createSessionContextHandler(services, config), auth: true });

    this.router.addRoute({ method: 'GET', pattern: '/api/mcp/servers', handler: createListMcpServersHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/mcp/tools', handler: createListMcpToolsHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/mcp/call', handler: createCallMcpToolHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/mcp/connect', handler: createConnectMcpServerHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/mcp/disconnect', handler: createDisconnectMcpServerHandler(services), auth: true });

    // skills / specs
    this.router.addRoute({ method: 'GET', pattern: '/api/skills', handler: createListSkillsHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/skills/:name', handler: createGetSkillHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/specs', handler: createSpecsHandler(services), auth: true });

    // tools（工具元信息：name + icon，供前端渲染工具调用卡片图标）
    this.router.addRoute({ method: 'GET', pattern: '/api/tools', handler: createListToolsHandler(services), auth: true });
    this.router.addRoute({ method: 'PATCH', pattern: '/api/tools/:name', handler: createUpdateToolHandler(config), auth: true });

    // models
    this.router.addRoute({ method: 'GET', pattern: '/api/models', handler: createListModelsHandler(config), auth: true });
    this.router.addRoute({ method: 'PUT', pattern: '/api/models/current', handler: createSetCurrentModelHandler(config), auth: true });
    this.router.addRoute({ method: 'PUT', pattern: '/api/models/reorder', handler: createReorderModelsHandler(config), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/models', handler: createCreateModelHandler(config), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/models/:id/test', handler: createTestModelHandler(services), auth: true });
    this.router.addRoute({ method: 'PATCH', pattern: '/api/models/:id', handler: createUpdateModelHandler(config), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/models/:id', handler: createDeleteModelHandler(config), auth: true });

    // todos
    this.router.addRoute({ method: 'GET', pattern: '/api/todos/:sessionId', handler: createListTodosHandler(env), auth: true });
    this.router.addRoute({ method: 'PUT', pattern: '/api/todos/:sessionId', handler: createReplaceTodosHandler(env), auth: true });

    // tasks + 分组
    this.router.addRoute({ method: 'GET', pattern: '/api/tasks', handler: createListTasksHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/tasks', handler: createCreateTaskHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/tasks/:id', handler: createGetTaskHandler(services, env), auth: true });
    this.router.addRoute({ method: 'PATCH', pattern: '/api/tasks/:id', handler: createUpdateTaskHandler(services), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/tasks/:id', handler: createDeleteTaskHandler(services), auth: true });
    this.router.addRoute({ method: 'PUT', pattern: '/api/tasks/reorder', handler: createReorderTasksHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/task-groups', handler: createListTaskGroupsHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/task-groups', handler: createCreateTaskGroupHandler(services), auth: true });
    this.router.addRoute({ method: 'PATCH', pattern: '/api/task-groups/:id', handler: createUpdateTaskGroupHandler(services), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/task-groups/:id', handler: createDeleteTaskGroupHandler(services), auth: true });

    // 搜索
    this.router.addRoute({ method: 'GET', pattern: '/api/search', handler: createSearchHandler(services), auth: true });

    // agents
    this.router.addRoute({ method: 'GET', pattern: '/api/agents', handler: createListAgentsHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/agents', handler: createCreateAgentHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/agents/:id', handler: createGetAgentHandler(services), auth: true });
    this.router.addRoute({ method: 'PATCH', pattern: '/api/agents/:id', handler: createUpdateAgentHandler(services), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/agents/:id', handler: createDeleteAgentHandler(services), auth: true });
    this.router.addRoute({ method: 'PUT', pattern: '/api/agents/default', handler: createSetDefaultAgentHandler(services), auth: true });

    // automations
    this.router.addRoute({ method: 'GET', pattern: '/api/automations', handler: createListAutomationsHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/automations', handler: createCreateAutomationHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/automations/:id', handler: createGetAutomationHandler(services), auth: true });
    this.router.addRoute({ method: 'PATCH', pattern: '/api/automations/:id', handler: createUpdateAutomationHandler(services), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/automations/:id', handler: createDeleteAutomationHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/automations/:id/trigger', handler: createTriggerAutomationHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/automations/:id/pause', handler: createPauseAutomationHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/automations/:id/resume', handler: createResumeAutomationHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/automations/:id/history', handler: createAutomationHistoryHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/automation-templates', handler: createListAutomationTemplatesHandler(services), auth: true });

    // plugins（阶段6.1：复用 kernel.extensions，映射为 PluginItem[]）
    this.router.addRoute({ method: 'GET', pattern: '/api/plugins', handler: createListPluginsHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/plugins/:id', handler: createGetPluginHandler(services), auth: true });
    this.router.addRoute({ method: 'PATCH', pattern: '/api/plugins/:id', handler: createUpdatePluginHandler(services), auth: true });

    // filesystem（浏览器端文件夹选择：后端原生对话框拿真实绝对路径 + 搜索回退）
    this.router.addRoute({ method: 'POST', pattern: '/api/filesystem/pick-directory', handler: createPickDirectoryHandler(env), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/filesystem/resolve-directory', handler: createResolveDirectoryHandler(env), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/filesystem/suggest-paths', handler: createSuggestPathsHandler(env), auth: true });
  }

  private async startServer(): Promise<void> {
    const cfg = this.ctx.config.getAppConfig();
    let port = cfg.server.port;
    const host = cfg.security.bindLocalhostOnly ? '127.0.0.1' : cfg.server.host;

    if (cfg.server.autoPort) {
      port = await this.findFreePort(host, port);
      if (port !== cfg.server.port) {
        this.ctx.logger.warn(
          t('server.autoPortUnavailable', { configured: cfg.server.port, actual: port }),
        );
      }
    }

    const router = this.router;
    const wsHandler = this.wsHandler;
    const logger = this.ctx.logger;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const BunAny = Bun as any;
    let server: BunServer;
    try {
      server = BunAny.serve({
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
            logger.error(t('server.wsMessageFailed'), {
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/EADDRINUSE|address already in use/i.test(msg)) {
        this.ctx.logger.error(
          t('server.bindInUse', { host, port }),
          { error: msg, host, port },
        );
      } else {
        this.ctx.logger.error(
          t('server.startFailed', { host, port, msg }),
          { error: msg, host, port },
        );
      }
      throw err;
    }

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

  logger.debug(t('server.httpRequest', { method, url }));

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

export default (manifest: ModuleManifest): Module => {
  const m = new ServerModule();
  m.manifest = manifest;
  return m;
};
