// src/modules/server/routes/health.ts
// GET /api/health - 健康检查

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry } from '../../../core/types';

interface ExtensionStateInfo {
  getStates?: () => {
    modules: Record<string, string>;
    plugins: Record<string, string>;
  };
  getActiveCount?: () => number;
}

export function createHealthHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest): Promise<HttpResponse> => {
    const ext = services.tryResolve<ExtensionStateInfo>('kernel.extensions');
    const states = ext?.getStates?.();
    const modules = states?.modules ?? {};
    const plugins = states?.plugins ?? {};
    return {
      status: 200,
      body: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: services.list(),
        uptime: process.uptime(),
        modules: Object.keys(modules).length,
        plugins: Object.keys(plugins).length,
        moduleStates: modules,
        pluginStates: plugins,
      },
    };
  };
}
