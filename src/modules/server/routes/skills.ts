// src/modules/server/routes/skills.ts
// GET /api/skills, GET /api/skills/:name

import type { HttpRequest, HttpResponse, RouteHandler } from '../types';
import type { ServiceRegistry } from '../../../core/types';
import type { SkillRegistry } from '../../tools/skills';

export function createListSkillsHandler(services: ServiceRegistry): RouteHandler {
  return async (): Promise<HttpResponse> => {
    const registry = services.tryResolve<SkillRegistry>('skill.registry');
    if (!registry) {
      return { status: 200, body: { skills: [] } };
    }
    const skills = registry.list().map((s) => ({
      name: s.name,
      description: s.description,
      source: s.sourceFile?.includes('node_modules') || s.sourceFile?.includes('.moss')
        ? ('user' as const)
        : ('builtin' as const),
    }));
    return { status: 200, body: { skills } };
  };
}

export function createGetSkillHandler(services: ServiceRegistry): RouteHandler {
  return async (_req: HttpRequest, params?: Record<string, string>): Promise<HttpResponse> => {
    const name = params?.name;
    if (!name) {
      return { status: 400, body: { error: 'skill name required' } };
    }
    const registry = services.tryResolve<SkillRegistry>('skill.registry');
    if (!registry) {
      return { status: 404, body: { error: 'skill registry not available' } };
    }
    const skill = registry.get(name);
    if (!skill) {
      return { status: 404, body: { error: `skill '${name}' not found` } };
    }
    return {
      status: 200,
      body: {
        skill: {
          name: skill.name,
          description: skill.description,
          prompt: skill.prompt,
          sourceFile: skill.sourceFile,
          source: skill.sourceFile?.includes('.moss') ? 'user' : 'builtin',
        },
      },
    };
  };
}
