// src/modules/server/routes/plugins.ts
// GET   /api/plugins        —— 列出所有扩展（modules + plugins），映射为 PluginItem[]
// GET   /api/plugins/:id    —— 获取单个 plugin 详情
// PATCH /api/plugins/:id    —— 启用/禁用 plugin（id 即 extension name）

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry } from '../../../core/types';

interface ExtensionInfo {
  name: string;
  version: string;
  description?: string;
  type: 'module' | 'plugin';
  state: string;
  enabled: boolean;
}

/** 与前端 webui/src/types/api.ts PluginItem 对齐 */
interface PluginItem {
  id: string;
  name: string;
  description: string;
  iconGradient?: string;
  enabled: boolean;
  builtIn: boolean;
  type: 'module' | 'plugin';
  version?: string;
}

interface KernelExtensionsService {
  getList?: () => ExtensionInfo[];
  getActiveCount?: () => number;
  enable?: (name: string) => boolean;
  disable?: (name: string) => boolean;
  isDisabled?: (name: string) => boolean;
}

function toPluginItem(e: ExtensionInfo): PluginItem {
  return {
    id: e.name,
    name: e.name,
    description: e.description ?? '',
    enabled: e.enabled,
    // 当前所有扩展均为内置（随包发布）
    builtIn: true,
    type: e.type,
    version: e.version,
  };
}

export function createListPluginsHandler(services: ServiceRegistry): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const ext = services.tryResolve<KernelExtensionsService>('kernel.extensions');
    if (!ext?.getList) {
      return { status: 200, body: { plugins: [] } };
    }
    const list = ext.getList();
    const plugins = list.map(toPluginItem);
    return { status: 200, body: { plugins } };
  };
}

export function createGetPluginHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: 'plugin id required' } };
    }
    const ext = services.tryResolve<KernelExtensionsService>('kernel.extensions');
    if (!ext?.getList) {
      return { status: 404, body: { error: 'plugin not found' } };
    }
    const found = ext.getList().find(e => e.name === id);
    if (!found) {
      return { status: 404, body: { error: `plugin '${id}' not found` } };
    }
    return { status: 200, body: toPluginItem(found) };
  };
}

export function createUpdatePluginHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const id = params?.id;
    if (!id) {
      return { status: 400, body: { error: 'plugin id required' } };
    }
    const body = (req.body ?? {}) as { enabled?: boolean };
    if (body.enabled === undefined) {
      return { status: 400, body: { error: 'enabled field required' } };
    }

    const ext = services.tryResolve<KernelExtensionsService>('kernel.extensions');
    if (!ext) {
      return { status: 503, body: { error: 'kernel.extensions service not available' } };
    }

    if (body.enabled) {
      ext.enable?.(id);
    } else {
      ext.disable?.(id);
    }

    const enabled = !ext.isDisabled?.(id);
    return { status: 200, body: { id, name: id, enabled, builtIn: true, type: 'plugin' as const, description: '' } };
  };
}
