// webui/src/components/shared/AskPromptCard.tsx
// 提问卡片：渲染 ask 工具发起的待答提问，提供文本输入与发送，调用 replyAsk 打通链路。
// ask 不进入 message.toolCalls（走独立 WS 事件 → store.pendingAsks），故需独立渲染。
// 样式与 TodoProgressCard inline 变体一致，保证视觉统一。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircle, Send, Loader2 } from 'lucide-react';
import type { PendingAsk } from '../../types/api';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useChat } from '../../hooks/useChat';

interface AskPromptCardProps {
  ask: PendingAsk;
  className?: string;
}

export function AskPromptCard({ ask, className }: AskPromptCardProps) {
  const { t } = useTranslation();
  const { replyAsk } = useChat();
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);

  const submit = () => {
    const trimmed = answer.trim();
    if (!trimmed || sending) return;
    setSending(true);
    // replyAsk 同步发送 WS tool.ask.reply 并 removePendingAsk，
    // 本组件随 store 变化自动卸载，无需额外清理
    replyAsk(ask.toolCallId, trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3 shadow-sm',
        className,
      )}
    >
      {/* 头部 */}
      <div className="flex items-center gap-1.5">
        <HelpCircle className="size-3.5 text-primary" />
        <span className="text-xs font-medium text-foreground">{t('task.askTitle')}</span>
      </div>
      {/* 提问正文 */}
      <p className="whitespace-pre-wrap text-sm text-foreground">{ask.question}</p>
      {/* 回复输入区 */}
      <div className="flex items-center gap-2">
        <Input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('task.askPlaceholder')}
          disabled={sending}
          className="h-8 text-sm"
        />
        <Button
          size="sm"
          onClick={submit}
          disabled={!answer.trim() || sending}
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
