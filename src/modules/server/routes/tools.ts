// src/modules/server/routes/tools.ts
// GET /api/tools - 列出所有已注册工具的 name + icon（供前端渲染工具调用卡片图标）

import type { HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry } from '../../../core/types';
import type { ToolRegistry } from '../../contracts';

export function createListToolsHandler(services: ServiceRegistry): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const registry = services.tryResolve<ToolRegistry>('tool.registry');
    if (!registry) {
      return { status: 200, body: { tools: [] } };
    }
    const tools = registry.list().map((t) => ({ name: t.name, icon: t.icon }));
    return { status: 200, body: { tools } };
  };
}
