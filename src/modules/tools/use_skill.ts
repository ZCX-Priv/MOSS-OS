// src/plugins/tools/use_skill.ts
// use_skill 工具：调用内置 skill，返回 prompt 模板或处理结果。

import type { Tool, ToolResult } from './types';
import { SKILL_REGISTRY_SERVICE, type SkillRegistry } from './skills';

export const useSkillTool: Tool = {
  name: 'use_skill',
  description:
    'Invoke a built-in skill. Skills are predefined prompt templates or processing functions. ' +
    'Returns the skill output (typically a prompt to guide the conversation). ' +
    'Available skills: brainstorming, code-review, tdd, explain.',
  inputSchema: {
    type: 'object',
    properties: {
      skill: {
        type: 'string',
        description: 'Name of the skill to invoke.',
      },
      args: {
        type: 'object',
        description: 'Arguments to pass to the skill.',
        additionalProperties: true,
      },
    },
    required: ['skill'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
  },
  async execute(params, ctx): Promise<ToolResult> {
    const p = params as { skill: string; args?: unknown };
    if (!p.skill) {
      return { content: [{ type: 'text', text: 'Error: skill is required' }], isError: true };
    }

    const reg = ctx.services.tryResolve<SkillRegistry>(SKILL_REGISTRY_SERVICE);
    if (!reg) {
      return {
        content: [{ type: 'text', text: 'Error: skill registry not available' }],
        isError: true,
      };
    }

    const skill = reg.get(p.skill);
    if (!skill) {
      const available = reg.list().map(s => s.name).join(', ');
      return {
        content: [
          { type: 'text', text: `Error: skill "${p.skill}" not found. Available: ${available}` },
        ],
        isError: true,
      };
    }

    try {
      // 若有 handler，执行 handler
      if (skill.handler) {
        const result = await skill.handler(p.args ?? {}, { cwd: ctx.cwd });
        return {
          content: [{ type: 'text', text: result }],
          metadata: { skill: p.skill, mode: 'handler' },
        };
      }
      // 否则返回 prompt 文本
      const promptText =
        typeof skill.prompt === 'function' ? skill.prompt(p.args ?? {}) : skill.prompt;
      return {
        content: [{ type: 'text', text: promptText }],
        metadata: { skill: p.skill, mode: 'prompt' },
      };
    } catch (err) {
      return {
        content: [
          { type: 'text', text: `Error invoking skill "${p.skill}": ${err instanceof Error ? err.message : err}` },
        ],
        isError: true,
      };
    }
  },
};
