// src/modules/server/routes/extensions.ts
// GET   /api/extensions        —— 列出所有扩展（modules + plugins）
// PATCH /api/extensions/:name  —— 启用/禁用扩展（下次启动生效）

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry } from '../../../core/types';
import { ErrorCode } from '../../../core/error-codes';

interface ExtensionInfo {
  name: string;
  version: string;
  description?: string;
  type: 'module' | 'plugin';
  state: string;
  enabled: boolean;
}

interface KernelExtensionsService {
  getList?: () => ExtensionInfo[];
  getActiveCount?: () => number;
  enable?: (name: string) => boolean;
  disable?: (name: string) => boolean;
  isDisabled?: (name: string) => boolean;
}

export function createListExtensionsHandler(services: ServiceRegistry): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const ext = services.tryResolve<KernelExtensionsService>('kernel.extensions');
    if (!ext?.getList) {
      return { status: 200, body: { modules: [], plugins: [], activeCount: 0 } };
    }
    const list = ext.getList();
    const modules = list.filter(e => e.type === 'module');
    const plugins = list.filter(e => e.type === 'plugin');
    const activeCount = ext.getActiveCount?.() ?? 0;
    return { status: 200, body: { modules, plugins, activeCount } };
  };
}

export function createUpdateExtensionHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const name = params?.name;
    if (!name) {
      return { status: 400, body: { error: ErrorCode.EXTENSION_NAME_REQUIRED } };
    }
    const body = (req.body ?? {}) as { enabled?: boolean };
    if (body.enabled === undefined) {
      return { status: 400, body: { error: ErrorCode.EXTENSION_ENABLED_REQUIRED } };
    }

    const ext = services.tryResolve<KernelExtensionsService>('kernel.extensions');
    if (!ext) {
      return { status: 503, body: { error: ErrorCode.EXTENSIONS_SERVICE_UNAVAILABLE } };
    }

    if (body.enabled) {
      ext.enable?.(name);
    } else {
      ext.disable?.(name);
    }

    const enabled = !ext.isDisabled?.(name);
    return { status: 200, body: { name, enabled } };
  };
}