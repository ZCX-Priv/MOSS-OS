// tools/memory_search/index.ts
// memory_search 工具 execute 逻辑：L3 深度检索记忆宫殿（全量跨翼 BM25）。
// 元数据见同目录 tool.json。

import type { ToolContext, ToolResult } from '../types';
import { ServiceNames } from '../../../core/types';
import { MEMORY_HALLS } from '../../../modules/memory/types';
import type { MemoryEngineServiceImpl } from '../../../modules/memory/service';

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = (params ?? {}) as {
      query?: string;
      wing?: string;
      room?: string;
      hall?: string;
      topK?: number;
    };

    if (!p.query) {
      return { content: [{ type: 'text', text: 'Error: query is required' }], isError: true };
    }

    const engine = ctx.services.tryResolve<MemoryEngineServiceImpl>(ServiceNames.MEMORY_ENGINE);
    if (!engine) {
      return { content: [{ type: 'text', text: 'Error: memory engine not available' }], isError: true };
    }

    const hall =
      p.hall && MEMORY_HALLS.includes(p.hall as (typeof MEMORY_HALLS)[number])
        ? (p.hall as (typeof MEMORY_HALLS)[number])
        : undefined;
    const topK = Math.min(50, Math.max(1, p.topK ?? 10));

    const hits = engine.search(ctx.cwd, p.query, {
      ...(p.wing ? { wing: p.wing } : {}),
      ...(p.room ? { room: p.room } : {}),
      ...(hall ? { hall } : {}),
    }, topK);

    if (hits.length === 0) {
      return {
        content: [{ type: 'text', text: `未找到与「${p.query}」相关的记忆。可用 memory_list_rooms 查看宫殿结构。` }],
        metadata: { count: 0 },
      };
    }

    const lines = hits.map(
      m =>
        `- [${m.wing}/${m.room}/${m.hall}] (重要性${m.importance.toFixed(1)}${m.pinned ? '，置顶' : ''}) ${m.insight}\n  原文：${m.verbatim.slice(0, 200)}${m.verbatim.length > 200 ? '…' : ''}`,
    );
    return {
      content: [{ type: 'text', text: `检索到 ${hits.length} 条相关记忆：\n${lines.join('\n')}` }],
      metadata: { count: hits.length, ids: hits.map(h => h.id) },
    };
  },
};
