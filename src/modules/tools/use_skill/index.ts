// tools/use_skill/index.ts
// use_skill 工具 execute 逻辑：激活注册表中的 skill，返回 prompt 模板
// （渐进式披露第二级；目录式 skill 附带 references/scripts 文件清单供 LLM 按需 read）。
// 元数据见同目录 tool.json。

import type { ToolContext, ToolResult } from '../types';
import { ServiceNames } from '../../../core/types';
import type { SkillRegistry } from './registry';

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
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
      const available = reg.list().filter(s => reg.isEnabled(s.name)).map(s => s.name).join(', ');
      return {
        content: [
          { type: 'text', text: `Error: skill "${p.skill}" not found. Available: ${available || '(none)'}` },
        ],
        isError: true,
      };
    }

    // 启停校验（config.skills[name].enabled）
    if (!reg.isEnabled(p.skill)) {
      return {
        content: [{ type: 'text', text: `Error: skill "${p.skill}" is disabled` }],
        isError: true,
      };
    }

    try {
      let promptText = substitutePlaceholders(skill.prompt, p.args ?? {});
      // 渐进式披露第三级入口：目录式 skill 附带附属文件清单（LLM 用 read 工具按需读取）
      if (skill.files && skill.files.length > 0) {
        const base = skill.dir ?? '';
        const fileList = skill.files.map(f => `- ${base ? `${base}/` : ''}${f}`).join('\n');
        promptText += `\n\n---\n# 附属资源（按需用 read 工具读取，不要一次性全部读取）\n${fileList}`;
      }
      if (skill.allowedTools && skill.allowedTools.length > 0) {
        promptText += `\n\n# 建议仅使用以下工具：${skill.allowedTools.join(', ')}`;
      }
      return {
        content: [{ type: 'text', text: promptText }],
        metadata: {
          skill: p.skill,
          mode: 'prompt',
          ...(skill.dir ? { dir: skill.dir } : {}),
          ...(skill.files && skill.files.length > 0 ? { files: skill.files } : {}),
        },
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
