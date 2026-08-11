// src/modules/server/routes/tools.ts
// GET  /api/tools         - 列出所有已加载工具的完整信息（供前端工具管理 UI）
// PATCH /api/tools/:name  - 更新工具启用状态（写 config.tools[name].enabled，触发热生效）

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ConfigService, ServiceRegistry } from '../../../core/types';
import { ServiceNames } from '../../../core/types';
import type { ToolRegistry } from '../../contracts';

/** GET /api/tools：返回所有已加载工具（含 disabled）的完整信息 */
export function createListToolsHandler(services: ServiceRegistry): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const registry = services.tryResolve<ToolRegistry>(ServiceNames.TOOL_REGISTRY);
    if (!registry) {
      return { status: 200, body: { tools: [] } };
    }
    const tools = registry.list().map((t) => ({
      name: t.name,
      description: t.description,
      icon: t.icon,
      source: t.source ?? 'builtin',
      annotations: t.annotations,
      sourceDir: t.sourceDir,
      enabled: registry.isEnabled(t.name),
    }));
    return { status: 200, body: { tools } };
  };
}

/** PATCH /api/tools/:name：更新工具启用状态（enabled） */
export function createUpdateToolHandler(config: ConfigService): RouteHandler {
  return async (req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const name = params?.name;
    if (!name) {
      return { status: 400, body: { error: 'tool name required' } };
    }
    const body = (req.body ?? {}) as { enabled?: boolean };
    if (typeof body.enabled !== 'boolean') {
      return { status: 400, body: { error: 'field "enabled" (boolean) is required' } };
    }
    try {
      // updateAppConfig 做 deep merge，仅需传 patch；写入后 registry.isEnabled 实时生效
      await config.updateAppConfig({
        tools: { [name]: { enabled: body.enabled } },
      } as never);
      return { status: 200, body: { name, enabled: body.enabled } };
    } catch (err) {
      return {
        status: 400,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}
