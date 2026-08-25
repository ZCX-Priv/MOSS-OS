// tools/memory_list_rooms/index.ts
// memory_list_rooms 工具 execute 逻辑：列出记忆宫殿树（翼→房间→厅）。
// 元数据见同目录 tool.json。

import type { ToolContext, ToolResult } from '../types';
import { ServiceNames } from '../../../core/types';
import type { MemoryEngineServiceImpl } from '../../../modules/memory/service';

export default {
  async execute(_params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const engine = ctx.services.tryResolve<MemoryEngineServiceImpl>(ServiceNames.MEMORY_ENGINE);
    if (!engine) {
      return { content: [{ type: 'text', text: 'Error: memory engine not available' }], isError: true };
    }

    const tree = engine.palaceTree(ctx.cwd);
    if (tree.wings.length === 0) {
      return {
        content: [{ type: 'text', text: '记忆宫殿为空。可用 memory_save 保存第一条记忆。' }],
        metadata: { wings: 0 },
      };
    }

    const lines = tree.wings.map(w => {
      const rooms = w.rooms
        .map(r => `  - ${r.room}（${r.count} 条：${r.halls.map(h => `${h.hall}×${h.count}`).join('、')}）`)
        .join('\n');
      return `- 翼「${w.wing}」[${w.scope}]：共 ${w.total} 条\n${rooms}`;
    });
    return {
      content: [{ type: 'text', text: `记忆宫殿结构：\n${lines.join('\n')}` }],
      metadata: { wings: tree.wings.length, total: tree.wings.reduce((s, w) => s + w.total, 0) },
    };
  },
};
