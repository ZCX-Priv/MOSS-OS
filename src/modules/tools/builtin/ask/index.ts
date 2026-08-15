// builtin/ask/index.ts
// ask 工具 execute 逻辑：向用户提问并阻塞等待回复（支持四种回答类型）。
// 返回给 LLM 的固定格式为「问题 + 用户回答」，保证上下文完整。
// 元数据见同目录 tool.json。

import type { AskOption, AskOutcome, AskPayload, ToolContext, ToolResult } from '../../types';

const VALID_ANSWER_TYPES = new Set(['text', 'single', 'multi', 'boolean']);

/** 把用户回答拼装为人类可读文本（含题目） */
function formatAnswer(payload: AskPayload, outcome: AskOutcome): string {
  if (outcome.action === 'cancel') {
    return '用户取消了本次提问，未作回答。请勿原样重试同一问题，重新规划后续步骤或改用其他方式推进。';
  }
  const a = outcome.answer ?? {};
  const other = a.otherText?.trim();
  let answerText: string;
  switch (payload.answerType) {
    case 'boolean': {
      // boolean 与 single 同构：前端回传 selectedValues=['yes'|'no']
      const v = a.selectedValues?.[0] ?? a.selectedLabels?.[0];
      answerText = v === undefined || v === '' ? (other ? `其他（${other}）` : '（未作答）') : v === 'yes' || v === '是' ? '是' : v === 'no' || v === '否' ? '否' : String(v);
      break;
    }
    case 'single': {
      const label = a.selectedLabels?.[0];
      const value = a.selectedValues?.[0];
      const picked = label !== undefined ? (value !== undefined && label !== value ? `${label}（${value}）` : label) : value !== undefined ? String(value) : undefined;
      answerText = picked ?? (other ? `其他（${other}）` : '（未作答）');
      if (picked && other) answerText = `${picked}，并补充：${other}`;
      break;
    }
    case 'multi': {
      const parts: string[] = [];
      const labels = a.selectedLabels ?? [];
      const values = a.selectedValues ?? [];
      const n = Math.max(labels.length, values.length);
      for (let i = 0; i < n; i++) {
        const l = labels[i];
        const v = values[i];
        parts.push(l !== undefined ? (v !== undefined && l !== v ? `${l}（${v}）` : l) : String(v));
      }
      if (other) parts.push(`其他（${other}）`);
      answerText = parts.length > 0 ? parts.join('、') : '（未作答）';
      break;
    }
    default: {
      // text
      answerText = a.text?.trim() || other || '（未作答）';
      break;
    }
  }
  return answerText;
}

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = params as {
      question?: string;
      answerType?: string;
      options?: AskOption[];
      defaultAnswer?: string;
    };

    if (!p.question || typeof p.question !== 'string' || p.question.trim() === '') {
      return { content: [{ type: 'text', text: 'Error: question is required' }], isError: true };
    }

    const answerType = (p.answerType ?? 'text') as NonNullable<AskPayload['answerType']>;
    if (!VALID_ANSWER_TYPES.has(answerType)) {
      return { content: [{ type: 'text', text: `Error: invalid answerType "${String(p.answerType)}" (must be text/single/multi/boolean)` }], isError: true };
    }

    let options: AskOption[] | undefined;
    if (answerType === 'single' || answerType === 'multi') {
      if (!Array.isArray(p.options) || p.options.length < 2 || p.options.length > 6) {
        return { content: [{ type: 'text', text: 'Error: options with 2-6 items are required when answerType is single/multi' }], isError: true };
      }
      for (const opt of p.options) {
        if (!opt || typeof opt.value !== 'string' || !opt.value.trim() || typeof opt.label !== 'string' || !opt.label.trim()) {
          return { content: [{ type: 'text', text: 'Error: each option must have non-empty value and label' }], isError: true };
        }
      }
      options = p.options;
    }

    if (!ctx.askUser) {
      return {
        content: [{ type: 'text', text: 'Error: ask not supported in this context (no interactive channel)' }],
        isError: true,
      };
    }

    const payload: AskPayload = {
      question: p.question,
      answerType,
      ...(options ? { options } : {}),
      ...(typeof p.defaultAnswer === 'string' && p.defaultAnswer ? { defaultAnswer: p.defaultAnswer } : {}),
    };

    let outcome: AskOutcome;
    try {
      outcome = await ctx.askUser(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error: ask failed: ${msg}` }],
        isError: true,
      };
    }

    const answerText = formatAnswer(payload, outcome);
    const text = `问题：${payload.question}\n用户回答：${answerText}`;
    return {
      content: [{ type: 'text', text }],
      metadata: {
        question: payload.question,
        answerType,
        action: outcome.action,
        ...(outcome.answer ?? {}),
      },
    };
  },
};
