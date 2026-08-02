// src/modules/tools/use_skill.ts
// use_skill 工具：调用注册表中的 skill，返回 prompt 模板。
// Skill prompt 为纯文本，可能含 {{placeholder}} 占位符，由调用方通过 args 提供。

import type { Tool, ToolResult } from './types';
import { ServiceNames } from '../../core/types';
import type { SkillRegistry } from './skills';

export const useSkillTool: Tool = {
  name: 'use_skill',
  description:
    'Invoke a registered skill. Skills are prompt templates loaded from the skills/ directory. ' +
    'Returns the skill prompt text (with {{placeholder}} substitution from args). ' +
    'Available built-in skills: brainstorming, code-review, tdd, explain.',
  inputSchema: {
    type: 'object',
    properties: {
      skill: {
        type: 'string',
        description: 'Name of the skill to invoke.',
      },
      args: {
        type: 'object',
        description: 'Arguments to substitute into skill prompt placeholders (e.g. {topic: "react hooks"} for {{topic}}).',
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
    const p = params as { skill: string; args?: Record<string, unknown> };
    if (!p.skill) {
      return { content: [{ type: 'text', text: 'Error: skill is required' }], isError: true };
    }

    const reg = ctx.services.tryResolve<SkillRegistry>(ServiceNames.SKILL_REGISTRY);
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
      // 替换 prompt 中的 {{placeholder}} 占位符
      const promptText = substitutePlaceholders(skill.prompt, p.args ?? {});
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

/**
 * 将 prompt 中的 {{key}} 占位符替换为 args[key] 的字符串值。
 * 未提供的占位符保持原样（方便用户看到缺哪个参数）。
 */
function substitutePlaceholders(prompt: string, args: Record<string, unknown>): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      const val = args[key];
      return val === null || val === undefined ? match : String(val);
    }
    return match;
  });
}
