// src/modules/server/routes/skills.ts
// GET /api/skills, GET /api/skills/:name, PATCH /api/skills/:name（启停）

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ConfigService, ServiceRegistry } from '../../../core/types';
import type { SkillRegistry, Skill } from '../../tools/use_skill/registry';
import { ErrorCode } from '../../../core/error-codes';

/** Skill → 前端 API 形状（含启停状态与扩展字段） */
function toSkillItem(
  s: Skill,
  registry: SkillRegistry,
): Record<string, unknown> {
  return {
    name: s.name,
    description: s.description,
    prompt: s.prompt,
    sourceFile: s.sourceFile,
    source: 'user' as const,
    enabled: registry.isEnabled(s.name),
    ...(s.dir ? { dir: s.dir } : {}),
    ...(s.greet ? { greet: s.greet } : {}),
    ...(s.icon ? { icon: s.icon } : {}),
    ...(s.allowedTools ? { allowedTools: s.allowedTools } : {}),
    ...(s.files && s.files.length > 0 ? { files: s.files } : {}),
  };
}

export function createListSkillsHandler(services: ServiceRegistry): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const registry = services.tryResolve<SkillRegistry>('skill.registry');
    if (!registry) {
      return { status: 200, body: { skills: [] } };
    }
    const skills = registry.list().map(s => toSkillItem(s, registry));
    return { status: 200, body: { skills } };
  };
}

export function createGetSkillHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const name = params?.name;
    if (!name) {
      return { status: 400, body: { error: ErrorCode.SKILL_NAME_REQUIRED } };
    }
    const registry = services.tryResolve<SkillRegistry>('skill.registry');
    if (!registry) {
      return { status: 404, body: { error: ErrorCode.SKILL_REGISTRY_UNAVAILABLE } };
    }
    const skill = registry.get(name);
    if (!skill) {
      return { status: 404, body: { error: ErrorCode.SKILL_NOT_FOUND } };
    }
    // 自定义 svg 图标：icon 以 .svg 结尾且为目录式 skill 时读取文件内容
    let iconSvg: string | undefined;
    if (skill.icon && skill.icon.endsWith('.svg') && skill.dir) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('node:fs');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const path = require('node:path');
        const iconPath = path.resolve(skill.dir, skill.icon);
        // 路径穿越防护：解析后必须仍在 skill 目录内
        if (iconPath.startsWith(path.resolve(skill.dir))) {
          iconSvg = fs.readFileSync(iconPath, 'utf8');
        }
      } catch {
        // 图标读取失败：忽略，前端回退默认图标
      }
    }
    return {
      status: 200,
      body: {
        skill: {
          ...toSkillItem(skill, registry),
          ...(iconSvg ? { iconSvg } : {}),
        },
      },
    };
  };
}

/** PATCH /api/skills/:name — 切换 skill 启用状态（写 config.skills[name].enabled，热生效） */
export function createUpdateSkillHandler(
  services: ServiceRegistry,
  config: ConfigService,
): RouteHandler {
  return async (req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const name = params?.name;
    if (!name) {
      return { status: 400, body: { error: ErrorCode.SKILL_NAME_REQUIRED } };
    }
    const registry = services.tryResolve<SkillRegistry>('skill.registry');
    if (!registry) {
      return { status: 404, body: { error: ErrorCode.SKILL_REGISTRY_UNAVAILABLE } };
    }
    const skill = registry.get(name);
    if (!skill) {
      return { status: 404, body: { error: ErrorCode.SKILL_NOT_FOUND } };
    }
    const body = req.body as { enabled?: boolean } | undefined;
    if (typeof body?.enabled !== 'boolean') {
      return { status: 400, body: { error: 'enabled (boolean) is required' } };
    }
    try {
      const patch = { skills: { [name]: { enabled: body.enabled } } } as Record<string, unknown>;
      await config.updateAppConfig(patch);
      return { status: 200, body: { name, enabled: body.enabled } };
    } catch (err) {
      return {
        status: 500,
        body: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}
