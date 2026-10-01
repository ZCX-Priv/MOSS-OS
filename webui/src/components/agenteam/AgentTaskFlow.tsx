// webui/src/components/agenteam/AgentTaskFlow.tsx
// 单 agent（subagent / 团队成员）的「微缩任务流」：把该 agent 自己会话的消息
// 以紧凑样式内联到卡片里，并提供跳转到完整任务页的入口。
//
// 数据来源：GET /api/session/:id（历史末 N 条）+ WS agenteam.member.event（运行中增量刷新）。
// 不新增后端接口：agent 的会话 id 就是它的 taskId（TeamMember.sessionId / subagent session=…）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { CircleCheck, CircleDashed, CircleX, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '../../api/http';
import { wsClient } from '../../api/ws';
import { MarkdownRenderer } from '../../render';
import type { TaskMessage, ToolCall } from '../../types/api';

interface AgentTaskFlowProps {
  /** agent 自己的会话 id（= 其 taskId）；null 表示尚未派发 */
  sessionId: string | null;
  /** 取末 N 条（默认 20） */
  limit?: number;
  className?: string;
}

/** 运行中增量刷新节流（ms）：成员事件高频，避免每个事件都打一次请求 */
const RELOAD_THROTTLE_MS = 1200;

function toolStatusIcon(status: ToolCall['status']) {
  if (status === 'generating' || status === 'executing') {
    return <Loader2 className="size-3 shrink-0 animate-spin text-blue-500" />;
  }
  if (status === 'done') return <CircleCheck className="size-3 shrink-0 text-emerald-500" />;
  return <CircleDashed className="size-3 shrink-0 text-muted-foreground/60" />;
}

export function AgentTaskFlow({ sessionId, limit = 20, className }: AgentTaskFlowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const resp = await api.getSessionHistory(sessionId, { limit });
      // 只保留有内容的消息，避免空气泡占位
      setMessages(
        resp.messages.filter((m) => m.role === 'user' || m.role === 'assistant'),
      );
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [sessionId, limit]);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    let alive = true;
    setLoading(true);
    void load().finally(() => {
      if (alive) setLoading(false);
    });
    const unsub = wsClient.onMessage((msg) => {
      if (msg.type !== 'agenteam.member.event') return;
      const payload = (msg.payload ?? {}) as { taskId?: string | null };
      if (payload.taskId !== sessionId) return;
      if (timerRef.current !== null) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void load();
      }, RELOAD_THROTTLE_MS);
    });
    return () => {
      alive = false;
      unsub();
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [sessionId, load]);

  const visible = useMemo(() => messages.slice(-limit), [messages, limit]);

  if (!sessionId) {
    return (
      <div className={cn('rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground', className)}>
        {t('agenteam.card.noSessionYet')}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/30 p-2', className)}>
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span>{t('agenteam.card.flowTitle')}</span>
        {loading && <Loader2 className="size-2.5 animate-spin" />}
      </div>

      <div className="flex max-h-[280px] flex-col gap-2 overflow-auto no-scrollbar">
        {visible.length === 0 && !loading && (
          <div className="px-1 py-2 text-[11px] text-muted-foreground">
            {failed ? t('agenteam.card.flowLoadFailed') : t('agenteam.card.flowEmpty')}
          </div>
        )}
        {visible.map((m) => (
          <div key={m.id} className="flex flex-col gap-1">
            {m.role === 'user' ? (
              <div className="self-end rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground/90 max-w-[92%]">
                <span className="line-clamp-4 whitespace-pre-wrap break-words">{m.content}</span>
              </div>
            ) : (
              <>
                {m.content && (
                  <div className="text-[11px] text-foreground/90">
                    <MarkdownRenderer text={m.content} variant="compact" defer />
                  </div>
                )}
                {m.toolCalls?.map((tc) => (
                  <div key={tc.id} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    {toolStatusIcon(tc.status)}
                    <span className="mono truncate">{tc.name}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => navigate(`/task/${sessionId}`)}
        className="flex items-center gap-1 self-start rounded-md px-1.5 py-0.5 text-[11px] text-primary-strong transition-colors hover:bg-muted"
      >
        <ExternalLink className="size-3" />
        {t('agenteam.card.openFullTask')}
      </button>
    </div>
  );
}
