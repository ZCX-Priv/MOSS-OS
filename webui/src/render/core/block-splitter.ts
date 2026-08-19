// render/core/block-splitter.ts
// 块分割器：流式渲染不闪烁的核心。
//
// 设计原理：LLM 输出是 append-only 文本流。以空行为块边界把全文切成块序列，
// 已闭合块（后面出现过空行）的 raw 永不再变化 → MarkdownBlock 用 React.memo 冻结，
// 每个流式 token 只重渲染最后一个活跃块。代码块/数学块只在闭合时高亮/排版一次。
//
// 跨空行结构：代码围栏（``` / ~~~）与 $$ 数学块内部的空行不视为边界（状态机吸收）。

import type { RenderBlock } from './types';

/** 围栏行：```lang 或 ~~~lang（允许缩进，覆盖列表内嵌代码块） */
const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;

/** 判断一行是否空行（仅空白） */
function isBlank(line: string): boolean {
  return line.trim() === '';
}

/** 统计一行中 `$$` 出现次数（用于奇偶判定数学块开合） */
function countDollarDollar(line: string): number {
  let count = 0;
  let i = 0;
  while ((i = line.indexOf('$$', i)) !== -1) {
    count++;
    i += 2;
  }
  return count;
}

/**
 * 把 markdown 文本切成块序列。
 *
 * closed 语义：块结束由空行分隔 → true；块到达文本末尾 → false（活跃块，可能继续增长）。
 * 未闭合围栏/数学块整体归入最后一个块（closed=false），渲染层按未闭合形态容错显示。
 */
export function splitBlocks(text: string): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  if (!text) return blocks;

  const lines = text.split('\n');
  let current: string[] = [];
  let inFence = false;
  let fenceChar = '`';
  let mathOpen = false; // 块内 $$ 计数为奇（跨行数学未闭合）
  let inBlock = false;

  const flush = (closed: boolean) => {
    if (current.length === 0) return;
    blocks.push({ index: blocks.length, raw: current.join('\n'), closed });
    current = [];
    inBlock = false;
    // fence/math 状态在 flush 时必须已归零（空行仅在非 fence/math 下才分块）
  };

  for (const line of lines) {
    if (isBlank(line) && !inFence && !mathOpen) {
      flush(true);
      continue;
    }

    if (!inBlock) {
      inBlock = true;
    }
    current.push(line);

    if (inFence) {
      // 尝试闭合：同字符、长度 >= 开栏长度、内容仅空白
      const m = FENCE_RE.exec(line);
      if (m && m[2][0] === fenceChar) {
        inFence = false;
        mathOpen = false;
      }
      continue;
    }

    // 围栏开栏检测（fence 行内的 $$ 不计数）
    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      inFence = true;
      fenceChar = fenceMatch[2][0];
      mathOpen = false;
      continue;
    }

    // 数学块奇偶追踪（单行 $$x$$ 计数 2 → 不改变状态；单独 $$ → 切换）
    if (countDollarDollar(line) % 2 === 1) {
      mathOpen = !mathOpen;
    }
  }

  // 文本末尾的块 = 活跃块
  flush(false);
  return blocks;
}
