// src/modules/server/index.ts
// Server 模块入口：基于 Bun.serve 启动 HTTP + WebSocket 服务。

import { t } from '../../core/i18n';
import type { Module, ModuleContext } from '../../core/types';
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
  createCreateMcpServerHandler,
  createUpdateMcpServerHandler,
  createDeleteMcpServerHandler,
} from './routes/mcp';
import {
  createListSkillsHandler,
  createGetSkillHandler,
  createUpdateSkillHandler,
  createCreateSkillHandler,
  createImportSkillHandler,
} from './routes/skills';
import {
  createListCommandsHandler,
  createCreateCommandHandler,
  createUpdateCommandHandler,
  createDeleteCommandHandler,
  createToggleCommandHandler,
} from './routes/commands';
import { createSpecsHandler, createUpdateSpecHandler, createCreateSpecHandler } from './routes/specs';
import { createListToolsHandler, createUpdateToolHandler } from './routes/tools';
import { createVersionHandler } from './routes/version';
import {
  createListProvidersHandler,
  createSetCurrentModelHandler,
  createCreateProviderHandler,
  createUpdateProviderHandler,
  createDeleteProviderHandler,
  createReorderProvidersHandler,
  createAddProviderModelsHandler,
  createUpdateProviderModelHandler,
  createDeleteProviderModelHandler,
  createTestProviderModelHandler,
  createFetchProviderModelsHandler,
  createProviderBalanceHandler,
  createAddProviderServiceHandler,
  createUpdateProviderServiceHandler,
  createDeleteProviderServiceHandler,
} from './routes/providers';
import { createListTodosHandler, createReplaceTodosHandler } from './routes/todos';
import {
  createLogFilesHandler,
  createQueryLogsHandler,
  createCleanupLogsHandler,
} from './routes/logs';
import { createTruncatePreviewHandler, createTruncateHandler, createTruncateRestoreHandler } from './routes/truncate';
import {
  createListFileHistoryHandler,
  createUndoFileHistoryHandler,
  createRestoreFileHistoryHandler,
} from './routes/file-history';
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
} from './routes/agenteam';
import {
  createListAgentTeamsHandler,
  createGetAgentTeamHandler,
  createGetAgentTeamMessagesHandler,
  createCreateAgentTeamHandler,
  createApproveAgentTeamHandler,
  createDiscardAgentTeamHandler,
  createHaltAgentTeamHandler,
  createResumeAgentTeamHandler,
  createDeleteAgentTeamHandler,
  createListTeamProfilesHandler,
  createSaveTeamProfileHandler,
  createDeleteTeamProfileHandler,
  createRunSubagentHandler,
} from './routes/agent-teams';
import { createListAutomationsHandler,
  createCreateAutomationHandler,
  createGetAutomationHandler,
  createUpdateAutomationHandler,
  createDeleteAutomationHandler,
  createTriggerAutomationHandler,
  createPauseAutomationHandler,
  createResumeAutomationHandler,
  createAutomationHistoryHandler,
} from './routes/automations';
import {
  createResolveDirectoryHandler,
  createSuggestPathsHandler,
  createPickDirectoryHandler,
  createPickFileHandler,
  createSearchFilesHandler,
  createGetRootsHandler,
  createUpdateRootsHandler,
  createReadFileHandler,
} from './routes/filesystem';
import {
  createContextStatsHandler,
  createContextCompactionsHandler,
  createCompactPreviewHandler,
  createManualCompactHandler,
  createSummaryModelsHandler,
  createFileIndexStatusHandler,
  createFileIndexRebuildHandler,
} from './routes/context';
import {
  createListRulesHandler,
  createCreateRuleHandler,
  createGetRuleHandler,
  createUpdateRuleHandler,
  createDeleteRuleHandler,
} from './routes/rules';
import {
  createListHooksHandler,
  createCreateHookHandler,
  createGetHookHandler,
  createUpdateHookHandler,
  createDeleteHookHandler,
  createTestHookHandler,
  createHookHistoryHandler,
} from './routes/hooks';
import {
  createMemoryTreeHandler,
  createListMemoryHandler,
  createCreateMemoryHandler,
  createGetMemoryHandler,
  createUpdateMemoryHandler,
  createDeleteMemoryHandler,
  createDistillMemoryHandler,
} from './routes/memory';
import { McpExpose } from '../mcp/expose';

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

  private ctx!: ModuleContext;
  private router!: HttpRouter;
  private wsHandler!: WsHandler;
  private assets!: StaticAssets;
  private mcpExpose!: McpExpose;
  private server: BunServer | null = null;
  private actualPort = 0;
  private actualHost = '127.0.0.1';

  async initialize(ctx: ModuleContext): Promise<void> {
    this.ctx = ctx;
    this.assets = new StaticAssets(ctx.env);
    this.router = new HttpRouter(ctx.config, ctx.logger, this.assets);
    this.wsHandler = new WsHandler(ctx.services, ctx.logger);
    this.mcpExpose = new McpExpose({ config: ctx.config, services: ctx.services, logger: ctx.logger });

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
      registerExternalRun: (sid: string, c: AbortController) => this.wsHandler.registerExternalRun(sid, c),
      unregisterExternalRun: (sid: string, c: AbortController) => this.wsHandler.unregisterExternalRun(sid, c),
      onWSMessage: (h: WSMessageHandler) => this.wsHandler.onWSMessage(h),
      stop: async () => {
        if (this.server) await this.server.stop();
      },
    };
    ctx.services.register(ServiceNames.SERVER_INSTANCE, instance, {
      scope: 'server',
    });

    // 阶段5.3：订阅 config:changed 事件，转发为 WS config.changed
    // 通过 EventBus 解耦，避免 config-service / kernel 直接依赖 server.instance（循环依赖）
    ctx.eventBus.onAction('config:changed', (data) => {
      this.wsHandler.broadcast({ type: 'config.changed', payload: data });
      // 文件索引配置热重载：开关变化 → 引擎启停（context 引擎缺失时静默跳过）
      const contextEngine = ctx.services.tryResolve<{
        onFileIndexConfigChanged(): Promise<void>;
      }>(ServiceNames.CONTEXT_ENGINE);
      if (contextEngine) {
        void contextEngine.onFileIndexConfigChanged().catch(() => {
          // 配置热重载失败不影响主流程
        });
      }
    });
    // 资源文件（skill/spec/tool）热重载事件，转发为 WS resources.changed
    ctx.eventBus.onAction('resources:changed', (data) => {
      this.wsHandler.broadcast({ type: 'resources.changed', payload: data });
    });
    // MCP 连接状态变化（后台连接完成/断开/失败），转发为 WS mcp.status
    // 前端 useMcp 监听后自动刷新列表（启动后台连接完成时无需手动刷新）
    ctx.eventBus.onAction('mcp:server:connected', (data) => {
      this.wsHandler.broadcast({ type: 'mcp.status', payload: data });
    });
    ctx.eventBus.onAction('mcp:server:disconnected', (data) => {
      this.wsHandler.broadcast({ type: 'mcp.status', payload: data });
    });
    ctx.eventBus.onAction('mcp:server:error', (data) => {
      this.wsHandler.broadcast({ type: 'mcp.status', payload: data });
    });
    // AgentTeam 编排事件：团队状态变化（前端专家团标签页监听后拉取刷新）
    ctx.eventBus.onAction('agenteam:team-changed', (data) => {
      this.wsHandler.broadcast({ type: 'agenteam.team.changed', payload: data });
    });
    // AgentTeam 成员事件（成员 run 的 agent 事件流；专家团面板展示活动摘要）
    ctx.eventBus.onAction('agenteam:member-event', (data) => {
      this.wsHandler.broadcast({ type: 'agenteam.member.event', payload: data });
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

    // 消息撤回（截断）：预览 + 执行 + 恢复（redo）
    this.router.addRoute({ method: 'GET', pattern: '/api/sessions/:id/truncate-preview', handler: createTruncatePreviewHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/sessions/:id/truncate', handler: createTruncateHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/sessions/:id/truncate-restore', handler: createTruncateRestoreHandler(services), auth: true });

    this.router.addRoute({ method: 'GET', pattern: '/api/mcp/servers', handler: createListMcpServersHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/mcp/tools', handler: createListMcpToolsHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/mcp/call', handler: createCallMcpToolHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/mcp/connect', handler: createConnectMcpServerHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/mcp/disconnect', handler: createDisconnectMcpServerHandler(services), auth: true });
    // MCP 服务器定义 CRUD（含 enabled 启停切换）
    this.router.addRoute({ method: 'POST', pattern: '/api/mcp/servers', handler: createCreateMcpServerHandler(services), auth: true });
    this.router.addRoute({ method: 'PUT', pattern: '/api/mcp/servers/:name', handler: createUpdateMcpServerHandler(services), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/mcp/servers/:name', handler: createDeleteMcpServerHandler(services), auth: true });

    // skills / specs
    this.router.addRoute({ method: 'GET', pattern: '/api/skills', handler: createListSkillsHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/skills/:name', handler: createGetSkillHandler(services), auth: true });
    this.router.addRoute({ method: 'PATCH', pattern: '/api/skills/:name', handler: createUpdateSkillHandler(services, config), auth: true });
    // skills 新建 / zip 导入（前端解包后批量写文件；目录 watch 热重载自动生效）
    this.router.addRoute({ method: 'POST', pattern: '/api/skills', handler: createCreateSkillHandler(services, env), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/skills/import', handler: createImportSkillHandler(services, env), auth: true });
    // commands（自定义斜杠命令：~/.moss/commands/<name>.md）
    this.router.addRoute({ method: 'GET', pattern: '/api/commands', handler: createListCommandsHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/commands', handler: createCreateCommandHandler(services, env), auth: true });
    this.router.addRoute({ method: 'PUT', pattern: '/api/commands/:name', handler: createUpdateCommandHandler(services, env), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/commands/:name', handler: createDeleteCommandHandler(services), auth: true });
    this.router.addRoute({ method: 'PATCH', pattern: '/api/commands/:name', handler: createToggleCommandHandler(services, config), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/specs', handler: createSpecsHandler(services), auth: true });
    // specs 保存（写回 ~/.moss/agent/prompts/main/spec/ 下文件）
    this.router.addRoute({ method: 'PUT', pattern: '/api/specs', handler: createUpdateSpecHandler(services, env), auth: true });
    // specs 新建（在用户 spec 目录下创建 <id>.md）
    this.router.addRoute({ method: 'POST', pattern: '/api/specs', handler: createCreateSpecHandler(services, env), auth: true });

    // tools（工具元信息 + 可编辑参数定义；PATCH 更新 config.tools[name] 热生效）
    this.router.addRoute({ method: 'GET', pattern: '/api/tools', handler: createListToolsHandler(services, config), auth: true });
    this.router.addRoute({ method: 'PATCH', pattern: '/api/tools/:name', handler: createUpdateToolHandler(services, config), auth: true });

    // providers（服务商 + 旗下模型；静态路由先于 :id 参数路由注册）
    this.router.addRoute({ method: 'GET', pattern: '/api/providers', handler: createListProvidersHandler(config), auth: true });
    this.router.addRoute({ method: 'PUT', pattern: '/api/providers/current', handler: createSetCurrentModelHandler(config), auth: true });
    this.router.addRoute({ method: 'PUT', pattern: '/api/providers/reorder', handler: createReorderProvidersHandler(config), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/providers', handler: createCreateProviderHandler(config), auth: true });
    this.router.addRoute({ method: 'PATCH', pattern: '/api/providers/:id', handler: createUpdateProviderHandler(config), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/providers/:id', handler: createDeleteProviderHandler(config), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/providers/:id/models', handler: createAddProviderModelsHandler(config), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/providers/:id/models/fetch', handler: createFetchProviderModelsHandler(config, this.ctx.logger), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/providers/:id/balance', handler: createProviderBalanceHandler(config, this.ctx.logger), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/providers/:id/models/:modelId/test', handler: createTestProviderModelHandler(services), auth: true });
    this.router.addRoute({ method: 'PATCH', pattern: '/api/providers/:id/models/:modelId', handler: createUpdateProviderModelHandler(config), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/providers/:id/models/:modelId', handler: createDeleteProviderModelHandler(config), auth: true });
    // services（服务商附加服务，当前仅文件存储）
    this.router.addRoute({ method: 'POST', pattern: '/api/providers/:id/services', handler: createAddProviderServiceHandler(config), auth: true });
    this.router.addRoute({ method: 'PATCH', pattern: '/api/providers/:id/services/:serviceId', handler: createUpdateProviderServiceHandler(config), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/providers/:id/services/:serviceId', handler: createDeleteProviderServiceHandler(config), auth: true });

    // todos
    this.router.addRoute({ method: 'GET', pattern: '/api/todos/:sessionId', handler: createListTodosHandler(env), auth: true });
    this.router.addRoute({ method: 'PUT', pattern: '/api/todos/:sessionId', handler: createReplaceTodosHandler(env), auth: true });

    // file-history（文件历史：列出 + 撤销 + 恢复）
    this.router.addRoute({ method: 'GET', pattern: '/api/file-history/:sessionId', handler: createListFileHistoryHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/file-history/:sessionId/undo', handler: createUndoFileHistoryHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/file-history/:sessionId/restore', handler: createRestoreFileHistoryHandler(services), auth: true });

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

    // agenteam
    this.router.addRoute({ method: 'GET', pattern: '/api/agenteam', handler: createListAgentsHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/agenteam', handler: createCreateAgentHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/agenteam/:id', handler: createGetAgentHandler(services), auth: true });
    this.router.addRoute({ method: 'PATCH', pattern: '/api/agenteam/:id', handler: createUpdateAgentHandler(services), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/agenteam/:id', handler: createDeleteAgentHandler(services), auth: true });
    this.router.addRoute({ method: 'PUT', pattern: '/api/agenteam/default', handler: createSetDefaultAgentHandler(services), auth: true });

    // agent-teams（AgentTeam 编排：团队/消息/生命周期/模板/临时subagent）
    this.router.addRoute({ method: 'GET', pattern: '/api/agent-teams', handler: createListAgentTeamsHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/agent-teams/:id', handler: createGetAgentTeamHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/agent-teams/:id/messages', handler: createGetAgentTeamMessagesHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/agent-teams', handler: createCreateAgentTeamHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/agent-teams/:id/approve', handler: createApproveAgentTeamHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/agent-teams/:id/discard', handler: createDiscardAgentTeamHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/agent-teams/:id/halt', handler: createHaltAgentTeamHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/agent-teams/:id/resume', handler: createResumeAgentTeamHandler(services), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/agent-teams/:id', handler: createDeleteAgentTeamHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/agent-team-profiles', handler: createListTeamProfilesHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/agent-team-profiles', handler: createSaveTeamProfileHandler(services), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/agent-team-profiles/:name', handler: createDeleteTeamProfileHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/subagents/run', handler: createRunSubagentHandler(services), auth: true });

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

    // filesystem（浏览器端文件夹选择：后端原生对话框拿真实绝对路径 + 搜索回退）
    this.router.addRoute({ method: 'POST', pattern: '/api/filesystem/pick-directory', handler: createPickDirectoryHandler(env), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/filesystem/pick-file', handler: createPickFileHandler(env, config), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/filesystem/resolve-directory', handler: createResolveDirectoryHandler(env), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/filesystem/suggest-paths', handler: createSuggestPathsHandler(env), auth: true });
    // # 文件提及菜单：工作目录递归文件名搜索
    this.router.addRoute({ method: 'GET', pattern: '/api/filesystem/search-files', handler: createSearchFilesHandler(env), auth: true });
    // 文件只读预览（渲染模块取 docx/pdf/图片/3D 模型二进制；走 filesys roots 权限 + 白名单）
    this.router.addRoute({ method: 'GET', pattern: '/api/filesystem/raw', handler: createReadFileHandler(this.ctx.services), auth: true });

    // filesys roots（虚拟文件系统授权目录管理）
    this.router.addRoute({ method: 'GET', pattern: '/api/filesys/roots', handler: createGetRootsHandler(this.ctx.services), auth: true });
    this.router.addRoute({ method: 'PUT', pattern: '/api/filesys/roots', handler: createUpdateRootsHandler(this.ctx.services, this.ctx.config), auth: true });

    // logs（日志文件列表 / 行查询过滤 / 过期清理）
    this.router.addRoute({ method: 'GET', pattern: '/api/logs/files', handler: createLogFilesHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/logs', handler: createQueryLogsHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/logs/cleanup', handler: createCleanupLogsHandler(services), auth: true });

    // context（上下文引擎：统计 / 压缩历史 / 手动压缩 / 摘要模型列表 / 文件索引）
    this.router.addRoute({ method: 'GET', pattern: '/api/context/summary-models', handler: createSummaryModelsHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/context/:sessionId/stats', handler: createContextStatsHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/context/:sessionId/compactions', handler: createContextCompactionsHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/context/:sessionId/compact-preview', handler: createCompactPreviewHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/context/:sessionId/compact', handler: createManualCompactHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/context/file-index/status', handler: createFileIndexStatusHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/context/file-index/rebuild', handler: createFileIndexRebuildHandler(services), auth: true });

    // rules（规则引擎：双作用域 CRUD）
    this.router.addRoute({ method: 'GET', pattern: '/api/rules', handler: createListRulesHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/rules', handler: createCreateRuleHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/rules/:id', handler: createGetRuleHandler(services), auth: true });
    this.router.addRoute({ method: 'PATCH', pattern: '/api/rules/:id', handler: createUpdateRuleHandler(services), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/rules/:id', handler: createDeleteRuleHandler(services), auth: true });

    // hooks（钩子引擎：双作用域 CRUD + 测试触发 + 执行历史）
    this.router.addRoute({ method: 'GET', pattern: '/api/hooks', handler: createListHooksHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/hooks', handler: createCreateHookHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/hooks/history', handler: createHookHistoryHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/hooks/:id', handler: createGetHookHandler(services), auth: true });
    this.router.addRoute({ method: 'PATCH', pattern: '/api/hooks/:id', handler: createUpdateHookHandler(services), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/hooks/:id', handler: createDeleteHookHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/hooks/:id/test', handler: createTestHookHandler(services), auth: true });

    // memory（记忆引擎：宫殿树 / 列表搜索 / CRUD + 手动蒸馏）
    this.router.addRoute({ method: 'GET', pattern: '/api/memory/tree', handler: createMemoryTreeHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/memory/distill', handler: createDistillMemoryHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/memory', handler: createListMemoryHandler(services), auth: true });
    this.router.addRoute({ method: 'POST', pattern: '/api/memory', handler: createCreateMemoryHandler(services), auth: true });
    this.router.addRoute({ method: 'GET', pattern: '/api/memory/:id', handler: createGetMemoryHandler(services), auth: true });
    this.router.addRoute({ method: 'PATCH', pattern: '/api/memory/:id', handler: createUpdateMemoryHandler(services), auth: true });
    this.router.addRoute({ method: 'DELETE', pattern: '/api/memory/:id', handler: createDeleteMemoryHandler(services), auth: true });
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
    const mcpExpose = this.mcpExpose;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const BunAny = Bun as any;
    let server: BunServer;
    try {
      server = BunAny.serve({
      port,
      hostname: host,
      // 顶层（HTTP 请求）：Bun 默认 10s 空闲即断连接，慢接口（文件索引 rebuild、
      // provider 拉模型等）会被中途杀掉；60s 对本地 API 安全
      idleTimeout: 60,
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
        // MCP 对外暴露端点（/mcp）：在 router 之前拦截，绕过 body 限制与 SPA fallback
        const mcpResp = await mcpExpose.handleRequest(req);
        if (mcpResp) return mcpResp;
        // 普通 HTTP 请求
        return handleHttp(req, router, logger);
      },
      websocket: {
        // 空闲超时（秒）：远大于前端 15s 应用层心跳 → 正常连接永不触发；
        // 兼做僵尸连接兜底清理（静默消失的客户端 60s 后回收）。
        // 注意：必须放在 websocket 块内，顶层放置会被 Bun 静默忽略
        idleTimeout: 60,
        // 禁用 Bun 自动协议层 ping：与 idleTimeout 协同存在 bug
        // （oven-sh/bun#26554：ping 超时导致非优雅关闭 → 代理层 ECONNRESET）。
        // 探活由前端应用层心跳（15s ping / 30s timeout）全权负责
        sendPings: false,
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

export default (): Module => new ServerModule();
