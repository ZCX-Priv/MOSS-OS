// webui/src/components/shared/ConfirmPromptCard.tsx
// 确认卡片：渲染 requireConfirmation 工具（shell/write/delete/undo）发起的待确认请求，
// 提供确认/取消按钮，调用 replyConfirm 打通链路。
// confirm 不进入 message.toolCalls（走独立 WS 事件 → store.pendingConfirms），故需独立渲染。
// 样式与 AskPromptCard 一致，保证视觉统一。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, Check, X, Loader2 } from 'lucide-react';
import type { PendingConfirm } from '../../types/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useTask } from '../../hooks/useTask';

interface ConfirmPromptCardProps {
  confirm: PendingConfirm;
  className?: string;
}

/** 格式化工具参数详情为可读字符串 */
function formatDetails(toolName: string, details: unknown): string {
  if (!details || typeof details !== 'object') return '';
  const d = details as Record<string, unknown>;
  // shell 工具优先展示 command
  if (toolName === 'shell' && typeof d.command === 'string') {
    const parts = [`$ ${d.command}`];
    if (typeof d.cwd === 'string') parts.push(`(cwd: ${d.cwd})`);
    return parts.join(' ');
  }
  // write/edit 展示 path
  if (typeof d.path === 'string') return d.path;
  // 通用：JSON 格式化（截断过长内容）
  try {
    const json = JSON.stringify(d, null, 2);
    return json.length > 500 ? json.slice(0, 500) + '\n...' : json;
  } catch {
    return '';
  }
}

export function ConfirmPromptCard({ confirm, className }: ConfirmPromptCardProps) {
  const { t } = useTranslation();
  const { replyConfirm } = useTask();
  const [sending, setSending] = useState(false);

  const handle = (ok: boolean) => {
    if (sending) return;
    setSending(true);
    // replyConfirm 同步发送 WS tool.confirm.reply 并 removePendingConfirm，
    // 本组件随 store 变化自动卸载，无需额外清理
    replyConfirm(confirm.toolCallId, ok);
  };

  const detailsText = formatDetails(confirm.toolName, confirm.details);

  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 rounded-lg border border-amber-500/40 bg-amber-50/50 p-3 shadow-sm dark:bg-amber-950/20',
        className,
      )}
    >
      {/* 头部 */}
      <div className="flex items-center gap-1.5">
        <ShieldAlert className="size-3.5 text-amber-600" />
        <span className="text-xs font-medium text-foreground">
          {t('task.confirmTitle')}
          {confirm.toolName ? ` · ${confirm.toolName}` : ''}
        </span>
      </div>
      {/* 提示文案 */}
      <p className="whitespace-pre-wrap text-sm text-foreground">{confirm.question}</p>
      {/* 参数详情 */}
      {detailsText && (
        <div className="rounded-md bg-muted/60 p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t('task.confirmDetails')}
          </div>
          <pre className="whitespace-pre-wrap break-all font-mono text-xs text-foreground">
            {detailsText}
          </pre>
        </div>
      )}
      {/* 确认/取消按钮 */}
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => handle(false)}
          disabled={sending}
          className="h-8 shrink-0 gap-1"
        >
          {sending ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
          <span>{t('task.confirmCancel')}</span>
        </Button>
        <Button
          size="sm"
          onClick={() => handle(true)}
          disabled={sending}
          className="h-8 shrink-0 gap-1"
        >
          {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          <span>{t('task.confirmApprove')}</span>
        </Button>
      </div>
    </div>
  );
}
