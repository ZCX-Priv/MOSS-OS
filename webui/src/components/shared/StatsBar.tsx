// 运行指标栏：任务输入框下方的一行统计（会话级累计口径，跨消息持续累加，刷新后恢复）。
// 常驻显示（无数据时按 0 值渲染）。指标：N轮·M步 | LLM 耗时 | 工具调用耗时 | 缓存命中 | 输入/输出 token

import { useTranslation } from 'react-i18next';
import type { RunStats } from '../../types/api';

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {label} <span className="text-foreground/80">{value}</span>
    </span>
  );
}

function Separator() {
  return <span className="select-none text-border" aria-hidden>|</span>;
}

/** 无数据时的全 0 兜底（常驻显示） */
const EMPTY_STATS: RunStats = {
  turns: 0,
  steps: 0,
  llmMs: 0,
  toolMs: 0,
  ttftCount: 0,
  ttftMsTotal: 0,
  decodeMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
};

export function StatsBar({ stats }: { stats?: RunStats }) {
  const { t } = useTranslation();
  const s = stats ?? EMPTY_STATS;
  const cacheHitPct = s.inputTokens > 0 ? Math.round((s.cachedTokens / s.inputTokens) * 100) : 0;

  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-x-2.5 gap-y-0.5 px-3 pb-1 pt-0.5 text-[11px] text-muted-foreground">
      <StatItem label="" value={t('stats.turnsSteps', { turns: s.turns, steps: s.steps })} />
      <Separator />
      <StatItem label={t('stats.llmLabel')} value={fmtMs(s.llmMs)} />
      <Separator />
      <StatItem label={t('stats.toolLabel')} value={fmtMs(s.toolMs)} />
      <Separator />
      <StatItem label={t('stats.cacheLabel')} value={t('stats.percent', { pct: cacheHitPct })} />
      <Separator />
      <StatItem label={t('stats.inputLabel')} value={t('stats.tokCount', { count: fmtTokens(s.inputTokens) })} />
      <Separator />
      <StatItem label={t('stats.outputLabel')} value={t('stats.tokCount', { count: fmtTokens(s.outputTokens) })} />
    </div>
  );
}
