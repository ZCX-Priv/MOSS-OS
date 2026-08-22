// UI/src/components/pages/AutomationPage.tsx
// 自动化任务页面：两 tab 路由化（/automation/configured | /automation/history）。
// 新建/编辑走 AutomationFormDialog（store 状态驱动），任务卡片渲染 lucide 图标。
// 支持 周期（cron）与 定时（once，完成后标记 completed 保留）两种调度。

import {
  Plus,
  Play,
  Pause,
  Pencil,
  Trash2,
  Clock,
  CalendarClock,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAutomations } from '../../hooks/useAutomations';
import { useStore } from '../../store';
import { getLucideIcon } from '../../lib/icons';
import { AutomationFormDialog } from './automation/AutomationFormDialog';
import { toast } from 'sonner';
import type { AutomationItem } from '../../types/api';

function formatTime(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function RunStatusIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 className="size-3.5 animate-spin text-blue-500" />;
  if (status === 'success') return <CheckCircle2 className="size-3.5 text-green-500" />;
  if (status === 'failed' || status === 'timeout') return <XCircle className="size-3.5 text-red-500" />;
  return <Clock className="size-3.5 text-muted-foreground" />;
}

/** 任务卡片图标：选中 lucide 图标，缺省回退首字母 */
function AutomationIcon({ item, active }: { item: AutomationItem; active: boolean }) {
  const Icon = item.icon ? getLucideIcon(item.icon) : undefined;
  return (
    <div
      className="flex size-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
      style={{
        backgroundImage: active
          ? 'linear-gradient(135deg, #6B4BCC, #8b5cf6)'
          : 'linear-gradient(135deg, #64748b, #475569)',
      }}
    >
      {Icon ? (
        <Icon className="size-5" />
      ) : (
        <span className="text-xs font-bold">{item.title.slice(0, 1)}</span>
      )}
    </div>
  );
}

// 从 pathname 派生当前 tab（configured/history）
function useCurrentAutomationTab(): string {
  const { pathname } = useLocation();
  const seg = pathname.split('/').pop() ?? '';
  return ['configured', 'history'].includes(seg) ? seg : 'configured';
}

export function AutomationPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tab = useCurrentAutomationTab();
  const openAutomationForm = useStore((s) => s.openAutomationForm);
  const editingId = useStore((s) => s.automationFormEditingId);
  // Badge 计数需要两个 tab 的数据，在布局层拉取
  const { automations, automationHistory } = useAutomations();
  const allHistoryCount = Object.values(automationHistory).flat().length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 页面头部 */}
      <div className="hidden items-center justify-between gap-4 px-6 py-4 md:flex">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground">{t('automation.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('automation.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button className="gap-1.5" onClick={() => openAutomationForm()}>
            <Plus />
            <span>{t('automation.manualCreate')}</span>
          </Button>
        </div>
      </div>

      {/* Tab 栏（路由驱动） */}
      <Tabs
        value={tab}
        onValueChange={(v) => navigate(`/automation/${v}`)}
      >
        <div className="px-6 py-3">
          <TabsList>
            <TabsTrigger value="configured" className="gap-1.5">
              {t('automation.configured')}
              <Badge variant="secondary">{automations.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              {t('automation.history')}
              <Badge variant="secondary">{allHistoryCount}</Badge>
            </TabsTrigger>
          </TabsList>
        </div>
      </Tabs>

      {/* 子路由内容 */}
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>

      {/* 新建/编辑表单（key 变化时重挂载重置表单） */}
      <AutomationFormDialog key={editingId ?? 'new'} />
    </div>
  );
}

/* ===== 已配置 tab ===== */
export function ConfiguredTab() {
  const { t } = useTranslation();
  const openAutomationForm = useStore((s) => s.openAutomationForm);
  const {
    automations,
    triggerAutomation,
    pauseAutomation,
    resumeAutomation,
    deleteAutomation,
  } = useAutomations();

  const handleTrigger = async (id: string) => {
    try {
      await triggerAutomation(id);
      toast.success(t('automation.triggeredToast'));
    } catch {
      /* hook 已 toast */
    }
  };

  const handleTogglePause = async (id: string, paused: boolean) => {
    try {
      if (paused) {
        await resumeAutomation(id);
      } else {
        await pauseAutomation(id);
      }
    } catch {
      /* hook 已 toast */
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAutomation(id);
      toast.success(t('automation.deletedToast'));
    } catch {
      /* hook 已 toast */
    }
  };

  return (
    <div className="p-6">
      <div className="flex flex-col gap-2">
        {automations.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t('automation.noConfigured')}
          </div>
        )}
        {automations.map((a) => {
          const completed = a.scheduleType === 'once' && a.completed;
          const enabled = a.enabled && !a.paused && !completed;
          return (
            <Card key={a.id} className="flex flex-row items-center gap-3 p-3">
              <AutomationIcon item={a} active={enabled} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-foreground">{a.title}</h3>
                  {completed && (
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      <CheckCircle2 className="size-3" />
                      {t('automation.completedBadge')}
                    </Badge>
                  )}
                  {!completed && a.paused && (
                    <Badge variant="outline" className="font-normal">
                      {t('automation.pausedBadge')}
                    </Badge>
                  )}
                  {!a.enabled && (
                    <Badge variant="outline" className="font-normal">
                      {t('automation.disabledBadge')}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {a.scheduleType === 'once' ? (
                    <span className="flex items-center gap-1">
                      <CalendarClock className="size-3" />
                      {t('automation.onceLabel')}: {formatTime(a.runAt)}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      <code className="rounded bg-muted px-1 py-0.5">{a.cron}</code>
                    </span>
                  )}
                  <span>
                    {t('automation.lastRunAt')}: {formatTime(a.lastRunAt)}
                  </span>
                  {!completed && (
                    <span>
                      {t('automation.nextRunAt')}: {formatTime(a.nextRunAt)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => openAutomationForm(a.id)}
                  title={t('automation.editBtn')}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => void handleTrigger(a.id)}
                  title={t('automation.triggerBtn')}
                >
                  <Play className="size-3.5" />
                </Button>
                {!completed && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => void handleTogglePause(a.id, a.paused)}
                    title={a.paused ? t('automation.resumeBtn') : t('automation.pauseBtn')}
                  >
                    {a.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  onClick={() => void handleDelete(a.id)}
                  title={t('automation.deleteBtn')}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ===== 历史 tab ===== */
export function HistoryTab() {
  const { t } = useTranslation();
  const { automations, automationHistory } = useAutomations();

  // 合并所有 automation 的历史，按 startedAt 倒序
  const allHistory = Object.values(automationHistory)
    .flat()
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));

  return (
    <div className="p-6">
      <div className="flex flex-col gap-2">
        {allHistory.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t('automation.noHistory')}
          </div>
        )}
        {allHistory.map((run) => {
          const automation = automations.find((a) => a.id === run.automationId);
          return (
            <Card key={run.id} className="flex flex-row items-center gap-3 p-3">
              <RunStatusIcon status={({ running: t('automation.statusRunning'), success: t('automation.statusSuccess'), failed: t('automation.statusFailed'), timeout: t('automation.statusTimeout') }[run.status] ?? run.status)} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-foreground">
                    {automation?.title ?? run.automationId}
                  </h3>
                  <Badge variant="secondary" className="font-normal">
                    {run.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {t('automation.startedAt')}: {formatTime(run.startedAt)}
                  </span>
                  <span>
                    {t('automation.finishedAt')}: {formatTime(run.finishedAt)}
                  </span>
                </div>
                {run.error && (
                  <p className="truncate text-xs text-destructive">{run.error}</p>
                )}
                {run.finalText && !run.error && (
                  <p className="truncate text-xs text-muted-foreground">{run.finalText}</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
