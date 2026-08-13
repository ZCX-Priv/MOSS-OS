// src/modules/server/routes/skills.ts
// GET /api/skills, GET /api/skills/:name

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry } from '../../../core/types';
import type { SkillRegistry } from '../../tools/skills';
import { ErrorCode } from '../../../core/error-codes';

export function createListSkillsHandler(services: ServiceRegistry): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const registry = services.tryResolve<SkillRegistry>('skill.registry');
    if (!registry) {
      return { status: 200, body: { skills: [] } };
    }
    const skills = registry.list().map((s) => ({
      name: s.name,
      description: s.description,
      source: 'user' as const,
    }));
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
    return {
      status: 200,
      body: {
        skill: {
          name: skill.name,
          description: skill.description,
          prompt: skill.prompt,
          sourceFile: skill.sourceFile,
          source: 'user' as const,
        },
      },
    };
  };
}