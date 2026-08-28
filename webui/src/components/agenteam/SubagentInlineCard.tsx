// webui/src/components/agenteam/SubagentInlineCard.tsx
// 对话流内 Subagent 卡片（参考 Max/TeamUI/Subagent.png 设计）：
// 头像图标 + 角色名 + 状态徽章 + 树形任务描述 + 运行中"已处理 N 条事件"实时计数
// + 完成后可展开最终报告（Markdown 渲染）。
// 事件计数数据源：store.agenteamEvents（useWebSocket 消费 agenteam.member.event 聚合）。

import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, ChevronRight, CircleCheck, CircleX, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '../../store';
import type { AgenteamEventEntry } from '../../store';
import { MarkdownRenderer } from '../../render';
import type { ToolCall } from '../../types/api';

interface SubagentInlineCardProps {
  /** 模板 agentId（如 agent_explorer） */
  template: string;
  /** 任务描述 */
  task: string;
  /** 工具调用状态（generating/executing=运行中；done=完成；缺省按完成处理） */
  status?: ToolCall['status'];
  /** 工具结果文本（完成后展示最终报告） */
  resultText?: string;
  /** 工具结果是否错误 */
  isError?: boolean;
}

/** subagent_run 结果文本固定前缀（tools.ts 拼装），剥离后为最终报告正文 */
const SUBAGENT_PREFIX = /^Subagent finished \(finishReason=[^,]+, session=[^)]+\):\n*/;

export const SubagentInlineCard = memo(function SubagentInlineCard({
  template,
  task,
  status,
  resultText,
  isError,
}: SubagentInlineCardProps) {
  const { t } = useTranslation();
  const running = status === 'generating' || status === 'executing';

  // 注册表显示名（如"探索专家"），查不到回落模板 id
  const agentName = useStore((s) => s.agents.find((a) => a.id === template)?.name);

  // 事件计数：取匹配该模板（teamId=null）的最新条目
  const events = useStore((s) => s.agenteamEvents);
  const entry = useMemo(() => {
    let best: AgenteamEventEntry | null = null;
    for (const e of Object.values(events)) {
      if (e.teamId === null && e.memberName === template && (!best || e.lastAt > best.lastAt)) {
        best = e;
      }
    }
    return best;
  }, [events, template]);

  const report = resultText?.replace(SUBAGENT_PREFIX, '') ?? '';
  // 缺参兜底：模板/任务缺失时仍渲染占位（名称回落 'subagent'），保证工具调用处不丢卡
  const displayName = agentName || template || 'subagent';

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
      {/* 行1：头像图标 + 角色名 + 状态徽章 */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
          {isError && !running ? (
            <Bot className="size-4 text-red-500" />
          ) : (
            <Bot className="size-4 text-foreground" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{displayName}</div>
          {template && (
            <div className="truncate font-mono text-[10px] text-muted-foreground">{template}</div>
          )}
        </div>
        {/* 状态徽章 */}
        {running ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
            <Loader2 className="size-2.5 animate-spin" />
            {t('agenteam.card.running')}
          </span>
        ) : isError ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-500">
            <CircleX className="size-2.5" />
            {t('agenteam.taskStatus.failed')}
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-500">
            <CircleCheck className="size-2.5" />
            {t('agenteam.taskStatus.completed')}
          </span>
        )}
      </div>

      {/* 行2：树形任务描述 */}
      {task && (
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 select-none text-muted-foreground/50">└</span>
          <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={task}>
            {task}
          </span>
        </div>
      )}

      {/* 行3（仅运行中）：实时事件计数 */}
      {running && (
        <div className="flex items-center gap-1.5 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 shrink-0 animate-spin" />
          <span>
            {entry && entry.count > 0
              ? t('agenteam.card.eventsProcessed', { count: entry.count })
              : t('agenteam.card.starting')}
          </span>
        </div>
      )}

      {/* 完成后：最终报告可展开（Markdown 渲染） */}
      {!running && report && (
        <details className="group border-t border-border/60 pt-2">
          <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
            <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
            <span className={cn(isError && 'text-destructive')}>
              {isError ? t('task.errorResult') : t('agenteam.card.report')}
            </span>
          </summary>
          <div className="mt-1 max-h-[300px] overflow-auto no-scrollbar text-xs">
            {isError ? (
              <pre className="mono whitespace-pre-wrap break-all text-destructive">{report}</pre>
            ) : (
              <MarkdownRenderer text={report} />
            )}
          </div>
        </details>
      )}
    </div>
  );
});
