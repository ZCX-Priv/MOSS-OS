// UI/src/components/pages/AutomationPage.tsx
// 自动化任务：阶段4.3 对接 useAutomations + useAutomationTemplates，移除硬编码。
// 三 tab 路由化：/automation/templates | /automation/configured | /automation/history

import {
  MessageSquarePlus,
  Newspaper,
  Eye,
  Crosshair,
  TrendingUp,
  ShieldCheck,
  Bug,
  FlaskConical,
  GitCommit,
  Plus,
  Play,
  Pause,
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAutomations } from '../../hooks/useAutomations';
import { useAutomationTemplates } from '../../hooks/useAutomations';
import { toast } from 'sonner';

// 已知模板 id → 图标的映射（与后端模板 id 对齐，未知模板回退首字母方块）
const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  'news-daily': Newspaper,
  'brand-weekly': Eye,
  'competitor-weekly': Crosshair,
  'stock-monitor': TrendingUp,
  'security-scan': ShieldCheck,
  'bug-scan': Bug,
  'test-coverage': FlaskConical,
  'daily-summary': GitCommit,
};

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

// 从 pathname 派生当前 tab（templates/configured/history）
function useCurrentAutomationTab(): string {
  const { pathname } = useLocation();
  const seg = pathname.split('/').pop() ?? '';
  return ['templates', 'configured', 'history'].includes(seg) ? seg : 'templates';
}

export function AutomationPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tab = useCurrentAutomationTab();
  // Badge 计数需要三个 tab 的数据，在布局层拉取
  const { automations, automationHistory } = useAutomations();
  const templates = useAutomationTemplates();
  const allHistoryCount = Object.values(automationHistory).flat().length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 页面头部 */}
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground">{t('automation.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('automation.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button className="gap-1.5">
            <Plus />
            <span>{t('automation.manualCreate')}</span>
          </Button>
          <Button variant="outline" className="gap-1.5">
            <MessageSquarePlus />
            <span>{t('automation.createInChat')}</span>
          </Button>
        </div>
      </div>

      {/* Tab 栏（路由驱动） */}
      <Tabs
        value={tab}
        onValueChange={(v) => navigate(`/automation/${v}`)}
      >
        <div className="border-b border-border px-6 py-3">
          <TabsList>
            <TabsTrigger value="configured" className="gap-1.5">
              {t('automation.configured')}
              <Badge variant="secondary">{automations.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              {t('automation.history')}
              <Badge variant="secondary">{allHistoryCount}</Badge>
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-1.5">
              {t('automation.templates')}
              <Badge variant="secondary">{templates.length}</Badge>
            </TabsTrigger>
          </TabsList>
        </div>
      </Tabs>

      {/* 子路由内容 */}
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}

/* ===== 模板 tab ===== */
export function TemplatesTab() {
  const { t } = useTranslation();
  const templates = useAutomationTemplates();

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.length === 0 && (
          <div className="col-span-full py-12 text-center text-sm text-muted-foreground">
            {t('automation.noConfigured', { defaultValue: '暂无模板' })}
          </div>
        )}
        {templates.map((template) => {
          const Icon = TEMPLATE_ICONS[template.id];
          const gradient =
            template.iconGradient ?? 'linear-gradient(135deg, #6366f1, #4f46d5)';
          return (
            <Card key={template.id} className="gap-2 p-4">
              <div
                className="flex size-10 items-center justify-center rounded-lg"
                style={{ backgroundImage: gradient }}
              >
                {Icon ? (
                  <Icon className="size-5 text-white" />
                ) : (
                  <span className="text-xs font-bold text-white">
                    {template.title.slice(0, 1)}
                  </span>
                )}
              </div>
              <CardTitle className="text-sm">{template.title}</CardTitle>
              <CardDescription className="text-xs">{template.description}</CardDescription>
              {template.cron && (
                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="size-3" />
                  <code className="rounded bg-muted px-1 py-0.5">{template.cron}</code>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ===== 已配置 tab ===== */
export function ConfiguredTab() {
  const { t } = useTranslation();
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
      toast.success(t('automation.triggered', { defaultValue: '已触发' }));
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
      toast.success(t('automation.deleted', { defaultValue: '已删除' }));
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
          const enabled = a.enabled && !a.paused;
          return (
            <Card key={a.id} className="flex flex-row items-center gap-3 p-3">
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                style={{
                  backgroundImage: enabled
                    ? 'linear-gradient(135deg, #6B4BCC, #8b5cf6)'
                    : 'linear-gradient(135deg, #64748b, #475569)',
                }}
              >
                {a.title.slice(0, 1)}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-foreground">{a.title}</h3>
                  {a.paused && (
                    <Badge variant="outline" className="font-normal">
                      {t('automation.paused', { defaultValue: '已暂停' })}
                    </Badge>
                  )}
                  {!a.enabled && (
                    <Badge variant="outline" className="font-normal">
                      {t('automation.disabled', { defaultValue: '已禁用' })}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    <code className="rounded bg-muted px-1 py-0.5">{a.cron}</code>
                  </span>
                  <span>
                    {t('automation.lastRun', { defaultValue: '上次' })}: {formatTime(a.lastRunAt)}
                  </span>
                  <span>
                    {t('automation.nextRun', { defaultValue: '下次' })}: {formatTime(a.nextRunAt)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => void handleTrigger(a.id)}
                  title={t('automation.triggered', { defaultValue: '触发' })}
                >
                  <Play className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => void handleTogglePause(a.id, a.paused)}
                  title={a.paused ? t('automation.resume', { defaultValue: '恢复' }) : t('automation.pause', { defaultValue: '暂停' })}
                >
                  {a.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  onClick={() => void handleDelete(a.id)}
                  title={t('automation.deleted', { defaultValue: '删除' })}
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
              <RunStatusIcon status={run.status} />
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
                    {t('automation.lastRun', { defaultValue: '开始' })}: {formatTime(run.startedAt)}
                  </span>
                  <span>
                    {t('automation.nextRun', { defaultValue: '结束' })}: {formatTime(run.finishedAt)}
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
