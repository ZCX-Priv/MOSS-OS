// src/modules/server/routes/health.ts
// GET /api/health - 健康检查

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry } from '../../../core/types';

interface ModuleStateInfo {
  getList?: () => Array<{ name: string; state: string }>;
}

export function createHealthHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest): Promise<HttpResponse> => {
    const mod = services.tryResolve<ModuleStateInfo>('kernel.modules');
    const list = mod?.getList?.() ?? [];
    const moduleStates: Record<string, string> = {};
    for (const m of list) moduleStates[m.name] = m.state;
    return {
      status: 200,
      body: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: services.list(),
        uptime: process.uptime(),
        modules: list.length,
        moduleStates,
      },
    };
  };
}
