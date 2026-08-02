// src/plugins/server/routes/health.ts
// GET /api/health - 健康检查

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry } from '../../../core/types';

export function createHealthHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest): Promise<HttpResponse> => {
    const pluginStates = services.tryResolve<{ getPluginStates?: () => Record<string, string> }>('kernel.states');
    return {
      status: 200,
      body: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: services.list(),
        uptime: process.uptime(),
      },
    };
  };
}
