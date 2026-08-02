// src/plugins/tools/skills.ts
// 内置 skill 注册表：预定义的 prompt 模板 + 可选处理函数。

export interface Skill {
  name: string;
  description: string;
  /** 调用此 skill 时返回的 prompt 文本（可作为系统提示注入） */
  prompt: string | ((args: unknown) => string);
  /** 可选的处理函数（若提供，则执行后返回结果；否则只返回 prompt） */
  handler?: (args: unknown, ctx: { cwd: string }) => Promise<string>;
}

/** 服务名 */
export const SKILL_REGISTRY_SERVICE = 'skill.registry';

export interface SkillRegistry {
  register(skill: Skill): void;
  get(name: string): Skill | null;
  list(): Skill[];
}

class SkillRegistryImpl implements SkillRegistry {
  private readonly skills = new Map<string, Skill>();
  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }
  get(name: string): Skill | null {
    return this.skills.get(name) ?? null;
  }
  list(): Skill[] {
    return Array.from(this.skills.values());
  }
}

export function createSkillRegistry(): SkillRegistry {
  const reg = new SkillRegistryImpl();
  // 注册内置 skills
  for (const skill of builtinSkills) {
    reg.register(skill);
  }
  return reg;
}

// ============================================================================
// 内置 skills
// ============================================================================

const builtinSkills: Skill[] = [
  {
    name: 'brainstorming',
    description:
      'Structured brainstorming: explore user intent, requirements, and design before implementation. ' +
      'Use before any creative work — creating features, building components, adding functionality.',
    prompt: `You are now in brainstorming mode. Before producing any artifact:
1. Explore the user's intent, requirements, and constraints.
2. Identify ambiguities and ask clarifying questions.
3. Propose multiple design alternatives with trade-offs.
4. Only after convergence, produce the final artifact.
Do NOT jump to implementation. Engage in dialogue first.`,
  },
  {
    name: 'code-review',
    description: 'Adversarial code review: find bugs, security issues, and design flaws.',
    prompt: `You are now in adversarial code review mode (red team). Be ruthless:
1. Look for logic bugs, off-by-one errors, null/undefined mishandling.
2. Check security: injection, path traversal, auth bypass, unsafe deserialization.
3. Check concurrency: race conditions, deadlocks, unhandled promise rejections.
4. Check resource leaks: file handles, connections, memory.
5. Check error handling: swallowed errors, missing try/catch, unhelpful messages.
6. Check API misuse: wrong types, wrong order of arguments, missing awaits.
Report findings by severity (critical/high/medium/low). For each, give file:line, description, and fix suggestion.`,
  },
  {
    name: 'tdd',
    description: 'Test-Driven Development: write failing test first, then implement.',
    prompt: `You are now in TDD mode. For each feature:
1. Write a failing test that specifies the desired behavior.
2. Run the test, confirm it fails for the right reason.
3. Write the minimum implementation to make the test pass.
4. Refactor while keeping tests green.
Do NOT write implementation before tests.`,
  },
  {
    name: 'explain',
    description: 'Explain code or concept clearly, assuming intelligent but unfamiliar reader.',
    prompt: (args) => {
      const a = (args ?? {}) as { topic?: string };
      return `Explain ${a.topic ?? 'the given topic'} clearly:
- Assume the reader is intelligent but unfamiliar with this specific area.
- Lead with the core idea, then expand with details.
- Use concrete examples.
- Call out common pitfalls and misconceptions.`;
    },
  },
];
