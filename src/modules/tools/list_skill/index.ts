// builtin/list_skill/index.ts
// list_skill 工具 execute 逻辑：列出所有启用的 skill（name + description + icon 提示）。
// 渐进式披露第一级：元数据扫描（~每 skill 数十个 token），完整内容经 use_skill 加载。
// 元数据见同目录 tool.json。

import type { ToolContext, ToolResult } from '../../types';
import { ServiceNames } from '../../../../core/types';
import type { SkillRegistry } from '../../skills';

export default {
  async execute(_params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const reg = ctx.services.tryResolve<SkillRegistry>(ServiceNames.SKILL_REGISTRY);
    if (!reg) {
      return {
        content: [{ type: 'text', text: 'Error: skill registry not available' }],
        isError: true,
      };
    }

    const skills = reg.list().filter(s => reg.isEnabled(s.name));
    if (skills.length === 0) {
      return {
        content: [{ type: 'text', text: '(no skills available)' }],
        metadata: { count: 0 },
      };
    }

    const lines = skills.map(
      s => `- ${s.name}: ${s.description || '(no description)'}`,
    );
    return {
      content: [
        {
          type: 'text',
          text: `=== Skills (${skills.length}) ===\n${lines.join('\n')}\n\n用 use_skill 激活某个 skill 获取完整指令。`,
        },
      ],
      metadata: { count: skills.length },
    };
  },
};
