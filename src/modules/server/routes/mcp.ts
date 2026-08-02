// src/plugins/server/routes/mcp.ts
// MCP 管理路由

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry } from '../../../core/types';
import type { MCPManager } from '../../contracts';

export function createListMcpServersHandler(services: ServiceRegistry): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const mgr = services.tryResolve<MCPManager>('mcp.manager');
    if (!mgr) {
      return { status: 200, body: { servers: [] } };
    }
    return { status: 200, body: { servers: mgr.listServers() } };
  };
}

export function createListMcpToolsHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const mgr = services.tryResolve<MCPManager>('mcp.manager');
    if (!mgr) {
      return { status: 200, body: { tools: [] } };
    }
    const serverName = (req.query.server as string) || undefined;
    return { status: 200, body: { tools: mgr.listTools(serverName) } };
  };
}

export function createCallMcpToolHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const mgr = services.tryResolve<MCPManager>('mcp.manager');
    if (!mgr) {
      return { status: 503, body: { error: 'MCP manager not available' } };
    }
    const body = req.body as { server?: string; tool?: string; arguments?: unknown } | undefined;
    if (!body?.server || !body?.tool) {
      return { status: 400, body: { error: 'server and tool required' } };
    }
    try {
      const result = await mgr.callTool(body.server, body.tool, body.arguments ?? {});
      return { status: 200, body: result };
    } catch (err) {
      return {
        status: 500,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}

export function createConnectMcpServerHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const mgr = services.tryResolve<MCPManager>('mcp.manager');
    if (!mgr) {
      return { status: 503, body: { error: 'MCP manager not available' } };
    }
    const body = req.body as { server?: string } | undefined;
    if (!body?.server) {
      return { status: 400, body: { error: 'server required' } };
    }
    try {
      await mgr.connect(body.server);
      return { status: 200, body: { connected: true, server: body.server } };
    } catch (err) {
      return {
        status: 500,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}

export function createDisconnectMcpServerHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const mgr = services.tryResolve<MCPManager>('mcp.manager');
    if (!mgr) {
      return { status: 503, body: { error: 'MCP manager not available' } };
    }
    const body = req.body as { server?: string } | undefined;
    if (!body?.server) {
      return { status: 400, body: { error: 'server required' } };
    }
    try {
      await mgr.disconnect(body.server);
      return { status: 200, body: { disconnected: true, server: body.server } };
    } catch (err) {
      return {
        status: 500,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}
