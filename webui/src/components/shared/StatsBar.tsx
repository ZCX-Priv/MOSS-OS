// 运行指标栏：任务输入框下方的一行统计（run 级口径，每次发送消息重置）。
// 指标：N轮·M步 | LLM 耗时 | 工具调用耗时 | 首 token 平均 | tok/s | 缓存命中 | 输入/输出 token

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

export function StatsBar({ stats }: { stats?: RunStats }) {
  const { t } = useTranslation();

  if (!stats || (stats.turns === 0 && stats.steps === 0)) {
    return (
      <div className="w-full px-4 pb-1 pt-0.5 text-center text-[11px] text-muted-foreground/60">
        {t('stats.empty')}
      </div>
    );
  }

  const ttftAvg = stats.ttftCount > 0 ? stats.ttftMsTotal / stats.ttftCount : undefined;
  const tokPerSec = stats.decodeMs > 0 ? Math.round((stats.outputTokens / stats.decodeMs) * 1000) : undefined;
  const cacheHitPct = stats.inputTokens > 0 ? Math.round((stats.cachedTokens / stats.inputTokens) * 100) : undefined;

  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-x-2.5 gap-y-0.5 px-3 pb-1 pt-0.5 text-[11px] text-muted-foreground">
      <StatItem label="" value={t('stats.turnsSteps', { turns: stats.turns, steps: stats.steps })} />
      <Separator />
      <StatItem label={t('stats.llmLabel')} value={fmtMs(stats.llmMs)} />
      <Separator />
      <StatItem label={t('stats.toolLabel')} value={fmtMs(stats.toolMs)} />
      {ttftAvg !== undefined && (
        <>
          <Separator />
          <StatItem label={t('stats.ttftLabel')} value={fmtMs(ttftAvg)} />
        </>
      )}
      {tokPerSec !== undefined && tokPerSec > 0 && (
        <>
          <Separator />
          <StatItem label="" value={t('stats.tokPerSec', { rate: tokPerSec })} />
        </>
      )}
      {cacheHitPct !== undefined && (
        <>
          <Separator />
          <StatItem label={t('stats.cacheLabel')} value={t('stats.percent', { pct: cacheHitPct })} />
        </>
      )}
      <Separator />
      <StatItem label={t('stats.inputLabel')} value={t('stats.tokCount', { count: fmtTokens(stats.inputTokens) })} />
      <Separator />
      <StatItem label={t('stats.outputLabel')} value={t('stats.tokCount', { count: fmtTokens(stats.outputTokens) })} />
    </div>
  );
}
