// tools/memory_save/index.ts
// memory_save 工具 execute 逻辑：保存一条长期记忆到记忆宫殿（L3 深度检索配套写入入口）。
// 元数据见同目录 tool.json。

import type { ToolContext, ToolResult } from '../types';
import { ServiceNames } from '../../../core/types';
import { MEMORY_HALLS } from '../../../modules/memory/types';
import type { MemoryEngineServiceImpl } from '../../../modules/memory/service';

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = (params ?? {}) as {
      room?: string;
      hall?: string;
      verbatim?: string;
      insight?: string;
      tags?: string[];
      importance?: number;
    };

    if (!p.room || !p.insight) {
      return { content: [{ type: 'text', text: 'Error: room and insight are required' }], isError: true };
    }
    if (!p.hall || !MEMORY_HALLS.includes(p.hall as (typeof MEMORY_HALLS)[number])) {
      return {
        content: [{ type: 'text', text: `Error: hall must be one of ${MEMORY_HALLS.join(', ')}` }],
        isError: true,
      };
    }

    const engine = ctx.services.tryResolve<MemoryEngineServiceImpl>(ServiceNames.MEMORY_ENGINE);
    if (!engine) {
      return { content: [{ type: 'text', text: 'Error: memory engine not available' }], isError: true };
    }

    try {
      // preference/suggestion → 全局 user wing；其余 → 当前项目 wing
      const isUserLevel = p.hall === 'preference' || p.hall === 'suggestion';
      const record = engine.save(ctx.cwd, {
        wing: isUserLevel ? 'user' : engine.currentWing(ctx.cwd),
        room: p.room,
        hall: p.hall as (typeof MEMORY_HALLS)[number],
        verbatim: p.verbatim ?? p.insight,
        insight: p.insight,
        ...(Array.isArray(p.tags) ? { tags: p.tags } : {}),
        ...(typeof p.importance === 'number' ? { importance: p.importance } : {}),
        source: { sessionId: ctx.sessionId },
      });
      return {
        content: [
          {
            type: 'text',
            text: `已保存记忆 [${record.wing}/${record.room}/${record.hall}] id=${record.id}：${record.insight}`,
          },
        ],
        metadata: { memoryId: record.id, wing: record.wing, room: record.room },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
};
