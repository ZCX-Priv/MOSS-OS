// tools/ask/index.ts
// ask 工具 execute 逻辑：向用户提问并阻塞等待回复（支持四种回答类型）。
// 返回给 LLM 的固定格式为「问题 + 用户回答」，保证上下文完整。
// 元数据见同目录 tool.json。

import { t } from '../../../core/i18n';
import type { AskOption, AskOutcome, AskPayload, ToolContext, ToolResult } from '../types';

const VALID_ANSWER_TYPES = new Set(['text', 'single', 'multi', 'boolean']);

/** 把用户回答拼装为人类可读文本（含题目） */
function formatAnswer(payload: AskPayload, outcome: AskOutcome): string {
  if (outcome.action === 'cancel') {
    return t('tools.askCancelled');
  }
  const a = outcome.answer ?? {};
  const other = a.otherText?.trim();
  let answerText: string;
  switch (payload.answerType) {
    case 'boolean': {
      // boolean 与 single 同构：前端回传 selectedValues=['yes'|'no']
      const v = a.selectedValues?.[0] ?? a.selectedLabels?.[0];
      answerText = v === undefined || v === '' ? (other ? t('tools.askOther', { text: other }) : t('tools.askNoAnswer')) : v === 'yes' || v === '是' ? t('tools.askYes') : v === 'no' || v === '否' ? t('tools.askNo') : String(v);
      break;
    }
    case 'single': {
      const label = a.selectedLabels?.[0];
      const value = a.selectedValues?.[0];
      const picked = label !== undefined ? (value !== undefined && label !== value ? t('tools.askLabelValue', { label, value }) : label) : value !== undefined ? String(value) : undefined;
      answerText = picked ?? (other ? t('tools.askOther', { text: other }) : t('tools.askNoAnswer'));
      if (picked && other) answerText = t('tools.askPickedWithOther', { picked, text: other });
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
        parts.push(l !== undefined ? (v !== undefined && l !== v ? t('tools.askLabelValue', { label: l, value: v }) : l) : String(v));
      }
      if (other) parts.push(t('tools.askOther', { text: other }));
      answerText = parts.length > 0 ? parts.join('、') : t('tools.askNoAnswer');
      break;
    }
    default: {
      // text
      answerText = a.text?.trim() || other || t('tools.askNoAnswer');
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
      return { content: [{ type: 'text', text: `Error: ${t('tools.askQuestionRequired')}` }], isError: true };
    }

    const answerType = (p.answerType ?? 'text') as NonNullable<AskPayload['answerType']>;
    if (!VALID_ANSWER_TYPES.has(answerType)) {
      return { content: [{ type: 'text', text: `Error: ${t('tools.askInvalidAnswerType', { type: String(p.answerType) })}` }], isError: true };
    }

    let options: AskOption[] | undefined;
    if (answerType === 'single' || answerType === 'multi') {
      if (!Array.isArray(p.options) || p.options.length < 2 || p.options.length > 6) {
        return { content: [{ type: 'text', text: `Error: ${t('tools.askOptionsRequired')}` }], isError: true };
      }
      for (const opt of p.options) {
        if (!opt || typeof opt.value !== 'string' || !opt.value.trim() || typeof opt.label !== 'string' || !opt.label.trim()) {
          return { content: [{ type: 'text', text: `Error: ${t('tools.askOptionInvalid')}` }], isError: true };
        }
      }
      options = p.options;
    }

    if (!ctx.askUser) {
      return {
        content: [{ type: 'text', text: `Error: ${t('tools.askNoChannel')}` }],
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
        content: [{ type: 'text', text: `Error: ${t('tools.askFailed', { message: msg })}` }],
        isError: true,
      };
    }

    const answerText = formatAnswer(payload, outcome);
    const text = `${t('tools.askQuestionLabel')}${payload.question}\n${t('tools.askAnswerLabel')}${answerText}`;
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
