// tools/list_skill/index.ts
// list_skill 工具 execute 逻辑：列出所有启用的 skill（name + description + icon 提示）。
// 渐进式披露第一级：元数据扫描（~每 skill 数十个 token），完整内容经 use_skill 加载。
// 元数据见同目录 tool.json。

import { t } from '../../../core/i18n';
import type { ToolContext, ToolResult } from '../types';
import { ServiceNames } from '../../../core/types';
import type { SkillRegistry } from '../use_skill/registry';

export default {
  async execute(_params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const reg = ctx.services.tryResolve<SkillRegistry>(ServiceNames.SKILL_REGISTRY);
    if (!reg) {
      return {
        content: [{ type: 'text', text: `Error: ${t('tools.listSkillRegistryUnavailable')}` }],
        isError: true,
      };
    }

    const skills = reg.list().filter(s => reg.isEnabled(s.name));
    if (skills.length === 0) {
      return {
        content: [{ type: 'text', text: t('tools.listSkillNoSkills') }],
        metadata: { count: 0 },
      };
    }

    const lines = skills.map(
      s => `- ${s.name}: ${s.description || t('tools.listSkillNoDescription')}`,
    );
    return {
      content: [
        {
          type: 'text',
          text: `${t('tools.listSkillHeader', { count: skills.length })}\n${lines.join('\n')}\n\n${t('tools.listSkillUseHint')}`,
        },
      ],
      metadata: { count: skills.length },
    };
  },
};
