// src/modules/server/routes/specs.ts
// GET /api/specs         —— 列出全部 specs
// GET /api/specs?id=xxx  —— 获取单个 spec 详情（query 形式规避路径参数含斜杠）

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry } from '../../../core/types';
import type { SpecRegistry } from '../../tools/specs';

/**
 * 统一 specs 路由处理器：无 query.id 时返回列表，有 query.id 时返回单条详情。
 */
export function createSpecsHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const registry = services.tryResolve<SpecRegistry>('spec.registry');

    // 详情：?id=xxx
    const id = req.query.id;
    if (id) {
      if (!registry) {
        return { status: 404, body: { error: 'spec registry not available' } };
      }
      const spec = registry.get(id);
      if (!spec) {
        return { status: 404, body: { error: `spec '${id}' not found` } };
      }
      return {
        status: 200,
        body: {
          spec: {
            id: spec.id,
            description: spec.description,
            content: spec.content,
            sourceFile: spec.sourceFile,
            source: spec.sourceFile?.includes('.moss') ? ('user' as const) : ('builtin' as const),
          },
        },
      };
    }

    // 列表
    if (!registry) {
      return { status: 200, body: { specs: [] } };
    }
    const specs = registry.list().map((s) => ({
      id: s.id,
      description: s.description,
      source: s.sourceFile?.includes('.moss') ? ('user' as const) : ('builtin' as const),
    }));
    return { status: 200, body: { specs } };
  };
}
