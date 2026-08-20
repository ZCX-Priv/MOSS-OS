// src/modules/server/routes/specs.ts
// GET  /api/specs         —— 列出全部 specs
// GET  /api/specs?id=xxx  —— 获取单个 spec 详情（query 形式规避路径参数含斜杠）
// PUT  /api/specs?id=xxx  —— 保存 spec 内容（写回 ~/.moss/agent/prompts/main/spec/ 下文件；watch 热重载）

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { Environment, ServiceRegistry } from '../../../core/types';
import type { SpecRegistry } from '../../tools/get_spec/registry';
import { ErrorCode } from '../../../core/error-codes';

/**
 * 统一 specs 路由处理器：无 query.id 时返回列表，有 query.id 时返回单条详情。
 * source 来自 Spec 对象（播种后全部在用户目录，恒为 'user'）。
 */
export function createSpecsHandler(services: ServiceRegistry): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const registry = services.tryResolve<SpecRegistry>('spec.registry');

    // 详情：?id=xxx
    const id = req.query.id;
    if (id) {
      if (!registry) {
        return { status: 404, body: { error: ErrorCode.SPEC_REGISTRY_UNAVAILABLE } };
      }
      const spec = registry.get(id);
      if (!spec) {
        return { status: 404, body: { error: ErrorCode.SPEC_NOT_FOUND } };
      }
      return {
        status: 200,
        body: {
          spec: {
            id: spec.id,
            description: spec.description,
            content: spec.content,
            sourceFile: spec.sourceFile,
            source: spec.source,
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
      source: s.source,
    }));
    return { status: 200, body: { specs } };
  };
}

/**
 * PUT /api/specs?id=xxx — 保存 spec 内容。
 * 仅允许写 ~/.moss/agent/prompts/main/spec/ 下的已有文件（路径穿越防护）；
 * 保存后 spec 目录 watch 自动热重载并广播 resources:changed。
 */
export function createUpdateSpecHandler(
  services: ServiceRegistry,
  env: Environment,
): RouteHandler {
  return async (req: HttpRequest): Promise<HttpResponse> => {
    const id = req.query.id;
    if (!id) {
      return { status: 400, body: { error: ErrorCode.SPEC_NOT_FOUND } };
    }
    const registry = services.tryResolve<SpecRegistry>('spec.registry');
    if (!registry) {
      return { status: 404, body: { error: ErrorCode.SPEC_REGISTRY_UNAVAILABLE } };
    }
    const spec = registry.get(id);
    if (!spec || !spec.sourceFile) {
      return { status: 404, body: { error: ErrorCode.SPEC_NOT_FOUND } };
    }
    const body = req.body as { content?: string; description?: string } | undefined;
    if (typeof body?.content !== 'string') {
      return { status: 400, body: { error: 'content (string) is required' } };
    }

    // 路径穿越防护：目标文件必须位于用户 spec 目录内
    // 统一走 utils 层 isPathInside（relative-based 判定，替代旧版字符串前缀匹配——
    // 后者在 Windows 下可被路径大小写差异绕过）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('node:path');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isPathInside } = require('../../../utils/fs');
    const specRoot = path.resolve(env.dataDir, 'agent', 'prompts', 'main', 'spec');
    const target = path.resolve(spec.sourceFile);
    if (!isPathInside(target, specRoot)) {
      return { status: 400, body: { error: 'spec file is outside the user spec directory' } };
    }

    try {
      // 保留原 front-matter 的 description（若提供新 description 则替换）
      let fm = '';
      const raw = fs.readFileSync(target, 'utf8');
      const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
      if (fmMatch) {
        const desc = typeof body.description === 'string' ? body.description : undefined;
        const lines = fmMatch[1].split('\n').filter((l: string) => !/^description\s*:/.test(l));
        if (desc) {
          lines.push(`description: ${desc.includes('\n') ? '>' : ''} ${desc.replace(/\n/g, ' ')}`.trimEnd());
        }
        fm = `---\n${lines.join('\n')}\n---\n\n`;
      }
      fs.writeFileSync(target, fm + body.content.trim() + '\n', 'utf8');
      return { status: 200, body: { saved: true, id } };
    } catch (err) {
      return {
        status: 500,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}
