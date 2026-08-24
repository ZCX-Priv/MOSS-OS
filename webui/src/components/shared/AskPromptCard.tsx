// webui/src/components/shared/AskPromptCard.tsx
// 提问卡片：渲染 ask 工具发起的待答提问，支持五种回答类型：
//   text（多行自由输入）/ single（单选按钮组）/ multi（复选按钮组）/ boolean（是/否）/
//   form（JSON Schema 动态表单——MCP elicitation 桥）。
// 所有类型固定附加「其他」自由输入项；选项 label 点击可编辑；右上角可取消提问。
// ask 不进入 message.toolCalls（走独立 WS 事件 → store.pendingAsks），故需独立渲染。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircle, Send, Loader2, X, Pencil, CircleCheck, Circle } from 'lucide-react';
import type { AskOutcome, AskOption, PendingAsk } from '../../types/api';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useTask } from '../../hooks/useTask';

interface AskPromptCardProps {
  ask: PendingAsk;
  className?: string;
}

/** form 模式：JSON Schema 字段描述（简化解析） */
interface FormField {
  key: string;
  type: 'string' | 'number' | 'boolean';
  title?: string;
  description?: string;
  required: boolean;
}

/** 从 formSchema 提取扁平字段列表（仅支持顶层 properties） */
function parseFormFields(schema: Record<string, unknown> | undefined): FormField[] {
  if (!schema) return [];
  const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!props || typeof props !== 'object') return [];
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  return Object.entries(props)
    .filter(([, def]) => {
      const t = (def as { type?: unknown })?.type;
      return t === 'string' || t === 'number' || t === 'integer' || t === 'boolean';
    })
    .map(([key, def]) => ({
      key,
      type: def.type === 'number' || def.type === 'integer' ? 'number' : (def.type as 'string' | 'boolean'),
      title: typeof def.title === 'string' ? def.title : undefined,
      description: typeof def.description === 'string' ? def.description : undefined,
      required: required.includes(key),
    }));
}

export function AskPromptCard({ ask, className }: AskPromptCardProps) {
  const { t } = useTranslation();
  const { replyAsk } = useTask();
  const [sending, setSending] = useState(false);

  // text 类型自由输入（含默认预填）
  const [textAnswer, setTextAnswer] = useState(ask.defaultAnswer ?? '');
  // single/multi 选中值
  const [selected, setSelected] = useState<string[]>([]);
  // 用户编辑后的选项 label：value → newLabel
  const [editedLabels, setEditedLabels] = useState<Record<string, string>>({});
  // 「其他」自由输入
  const [otherText, setOtherText] = useState('');
  const [otherOpen, setOtherOpen] = useState(false);
  // 当前编辑中的选项 value
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  // form 模式：字段值（string/number/boolean）
  const [formValues, setFormValues] = useState<Record<string, string | number | boolean>>({});

  const answerType = ask.answerType ?? 'text';
  const isForm = answerType === 'form';
  const formFields = isForm ? parseFormFields(ask.formSchema) : [];
  // boolean 渲染为固定的 是/否 选项
  const options: AskOption[] =
    answerType === 'boolean'
      ? [
          { value: 'yes', label: t('task.askYes') },
          { value: 'no', label: t('task.askNo') },
        ]
      : ask.options ?? [];
  const isChoice = answerType === 'single' || answerType === 'multi' || answerType === 'boolean';
  const isMulti = answerType === 'multi';

  const labelOf = (opt: AskOption): string => editedLabels[opt.value] ?? opt.label;

  const formMissingRequired = formFields.some(
    (f) => f.required && (formValues[f.key] === undefined || formValues[f.key] === ''),
  );

  const submitForm = () => {
    if (sending || formMissingRequired) return;
    setSending(true);
    replyAsk(ask.toolCallId, { action: 'accept', answer: { form: formValues } });
  };

  const submitChoice = (forcedSelected?: string[]) => {
    if (sending) return;
    const sel = forcedSelected ?? selected;
    const outcome: AskOutcome = { action: 'accept' };
    if (sel.length > 0) {
      const chosen = options.filter(o => sel.includes(o.value));
      outcome.answer = {
        selectedValues: chosen.map(o => o.value),
        selectedLabels: chosen.map(o => labelOf(o)),
        ...(Object.keys(editedLabels).length > 0 ? { editedLabels } : {}),
        ...(otherText.trim() ? { otherText: otherText.trim() } : {}),
      };
    } else if (otherText.trim()) {
      outcome.answer = { otherText: otherText.trim() };
    } else {
      return; // 未做任何选择
    }
    setSending(true);
    replyAsk(ask.toolCallId, outcome);
  };

  const submitText = () => {
    const trimmed = textAnswer.trim() || otherText.trim();
    if (!trimmed || sending) return;
    setSending(true);
    replyAsk(ask.toolCallId, {
      action: 'accept',
      answer: textAnswer.trim() ? { text: textAnswer.trim() } : { otherText: otherText.trim() },
    });
  };

  const cancel = () => {
    if (sending) return;
    setSending(true);
    replyAsk(ask.toolCallId, { action: 'cancel' });
  };

  const toggle = (value: string) => {
    if (isMulti) {
      setSelected(prev =>
        prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value],
      );
    } else {
      setSelected([value]);
    }
  };

  const startEdit = (opt: AskOption) => {
    setEditingValue(opt.value);
    setEditingDraft(labelOf(opt));
  };

  const commitEdit = () => {
    if (editingValue && editingDraft.trim()) {
      setEditedLabels(prev => ({ ...prev, [editingValue]: editingDraft.trim() }));
    }
    setEditingValue(null);
    setEditingDraft('');
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3 shadow-sm',
        className,
      )}
    >
      {/* 头部：标题 + 取消按钮 */}
      <div className="flex items-center gap-1.5">
        <HelpCircle className="size-3.5 text-primary" />
        <span className="text-xs font-medium text-foreground">{t('task.askTitle')}</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={cancel}
          disabled={sending}
          className="ml-auto h-6 gap-1 px-1.5 text-muted-foreground"
          title={t('task.askCancel')}
        >
          <X className="size-3" />
          <span className="text-[10px]">{t('task.askCancel')}</span>
        </Button>
      </div>

      {/* 提问正文 */}
      <p className="whitespace-pre-wrap text-sm text-foreground">{ask.question}</p>

      {/* text 类型：多行输入 */}
      {answerType === 'text' && (
        <textarea
          value={textAnswer}
          spellCheck={false}
          onChange={(e) => setTextAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submitText();
            }
          }}
          placeholder={t('task.askPlaceholder')}
          disabled={sending}
          rows={3}
          className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
      )}

      {/* form 类型：JSON Schema 动态表单（MCP elicitation） */}
      {isForm && (
        <div className="flex flex-col gap-2.5">
          {formFields.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('task.askFormEmpty')}</p>
          )}
          {formFields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1">
              <label className="flex items-center gap-1 text-xs font-medium text-foreground">
                {f.title ?? f.key}
                {f.required && <span className="text-destructive">*</span>}
              </label>
              {f.description && (
                <span className="text-[11px] leading-tight text-muted-foreground">{f.description}</span>
              )}
              {f.type === 'boolean' ? (
                <div className="flex items-center gap-2 py-0.5">
                  <Switch
                    checked={formValues[f.key] === true}
                    onCheckedChange={(v) => setFormValues((prev) => ({ ...prev, [f.key]: v }))}
                    disabled={sending}
                  />
                  <span className="text-xs text-muted-foreground">
                    {formValues[f.key] === true ? t('task.askYes') : t('task.askNo')}
                  </span>
                </div>
              ) : (
                <Input
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={String(formValues[f.key] ?? '')}
                  onChange={(e) =>
                    setFormValues((prev) => ({
                      ...prev,
                      [f.key]:
                        f.type === 'number'
                          ? e.target.value === ''
                            ? ''
                            : Number(e.target.value)
                          : e.target.value,
                    }))
                  }
                  disabled={sending}
                  className="h-8 text-sm"
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* single / multi / boolean：选项按钮组（label 可编辑） */}
      {isChoice && (
        <div className="flex flex-col gap-1.5">
          {options.map((opt) => {
            const checked = selected.includes(opt.value);
            const editing = editingValue === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                disabled={sending}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors',
                  checked
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-foreground hover:bg-muted/50',
                )}
              >
                {checked ? (
                  isMulti ? (
                    <CircleCheck className="size-4 shrink-0 text-primary" />
                  ) : (
                    <CircleCheck className="size-4 shrink-0 text-primary" />
                  )
                ) : (
                  <Circle className="size-4 shrink-0 text-muted-foreground" />
                )}
                {editing ? (
                  <Input
                    autoFocus
                    value={editingDraft}
                    onChange={(e) => setEditingDraft(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitEdit();
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setEditingValue(null);
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-6 flex-1 text-sm"
                  />
                ) : (
                  <span className="min-w-0 flex-1 break-words">{labelOf(opt)}</span>
                )}
                {!editing && (
                  <span
                    role="button"
                    tabIndex={0}
                    title={t('task.askEditOption')}
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(opt);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.stopPropagation();
                        startEdit(opt);
                      }
                    }}
                    className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-opacity hover:bg-muted hover:text-foreground [button:hover>&]:opacity-100"
                  >
                    <Pencil className="size-3" />
                  </span>
                )}
              </button>
            );
          })}

          {/* 「其他」自由输入（固定最后一项） */}
          <div
            className={cn(
              'flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm',
              otherOpen ? 'border-primary bg-primary/5' : 'border-border',
            )}
          >
            <button
              type="button"
              onClick={() => setOtherOpen(v => !v)}
              disabled={sending}
              className="flex items-center gap-2 text-left text-foreground"
            >
              {otherOpen ? (
                <CircleCheck className="size-4 shrink-0 text-primary" />
              ) : (
                <Circle className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="shrink-0">{t('task.askOther')}</span>
            </button>
            {otherOpen && (
              <Input
                autoFocus
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitChoice();
                  }
                }}
                placeholder={t('task.askOtherPlaceholder')}
                disabled={sending}
                className="h-7 flex-1 text-sm"
              />
            )}
          </div>
        </div>
      )}

      {/* 发送区 */}
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-[10px] text-muted-foreground">
          {answerType === 'text'
            ? 'Ctrl+Enter'
            : isMulti
              ? t('task.askMultiHint')
              : ''}
        </span>
        <Button
          size="sm"
          onClick={
            answerType === 'text'
              ? submitText
              : isForm
                ? submitForm
                : () => submitChoice()
          }
          disabled={
            sending ||
            (answerType === 'text'
              ? !(textAnswer.trim() || otherText.trim())
              : isForm
                ? formMissingRequired
                : selected.length === 0 && !otherText.trim())
          }
          className="h-8 shrink-0 gap-1"
        >
          {sending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          <span>{sending ? t('task.askSending') : t('task.askSend')}</span>
        </Button>
      </div>
    </div>
  );
}
