// webui/src/components/agenteam/AgentTeamPanel.tsx
// 专家团标签页主面板：全局团队列表 + 选中团队详情
//（计划审批卡片 / 成员卡片 / 任务列表 / 消息流 / 汇总 / 生命周期操作）。

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { api } from '../../api/http';
import { useAgentTeams } from '../../hooks/useAgentTeams';
import { cn } from '@/lib/utils';
import { HumationAvatar } from './HumationAvatar';
import { PlanReviewCard } from './PlanReviewCard';
import { MemberCard } from './MemberCard';
import { TaskListView } from './TaskListView';
import { MessageFeed } from './MessageFeed';
import { CreateTeamDialog } from './CreateTeamDialog';
import type { TeamPhase } from '../../types/api';

const PHASE_STYLE: Record<TeamPhase, string> = {
  staged: 'border-amber-500/60 text-amber-500',
  running: 'border-blue-500/60 text-blue-500',
  completed: 'border-emerald-500/60 text-emerald-500',
  failed: 'border-red-500/60 text-red-500',
  halted: 'border-muted text-muted-foreground',
};

export function AgentTeamPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { teams, selectedId, detail, messages, select, refreshList, refreshDetail } = useAgentTeams();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setActionBusy(true);
      try {
        await fn();
        await refreshList();
        if (selectedId) await refreshDetail(selectedId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setActionBusy(false);
      }
    },
    [refreshList, refreshDetail, selectedId],
  );

  const handleApprove = () => act(async () => {
    if (selectedId) await api.approveAgentTeam(selectedId);
  });
  const handleDiscard = () => act(async () => {
    if (selectedId) await api.discardAgentTeam(selectedId);
  });
  const handleHalt = () => act(async () => {
    if (selectedId) await api.haltAgentTeam(selectedId);
  });
  const handleResume = () => act(async () => {
    if (selectedId) await api.resumeAgentTeam(selectedId);
  });
  const handleDelete = () =>
    act(async () => {
      if (!deleteTarget) return;
      await api.deleteAgentTeam(deleteTarget);
      if (deleteTarget === selectedId) select(null);
      setDeleteTarget(null);
    });

  const activeMembers = detail?.members.filter((m) => m.status !== 'removed') ?? [];
  const workingMemberNames = new Set(
    activeMembers.filter((m) => m.status === 'working').map((m) => m.name),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 头部：新建按钮 */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Users className="size-3.5" />
          {t('agenteam.title')}
        </div>
        <Button variant="ghost" size="icon-sm" title={t('agenteam.createTeam')} onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
        </Button>
      </div>

      {/* 团队列表 */}
      <div className="max-h-44 shrink-0 overflow-y-auto border-b border-border">
        {teams.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">{t('agenteam.empty')}</div>
        ) : (
          <div className="p-1.5">
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  team.id === selectedId ? 'bg-accent' : 'hover:bg-accent/50',
                )}
                onClick={() => select(team.id === selectedId ? null : team.id)}
              >
                <ChevronRight
                  className={cn(
                    'size-3 shrink-0 text-muted-foreground transition-transform',
                    team.id === selectedId && 'rotate-90',
                  )}
                />
                <HumationAvatar seed={team.id} size={22} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">{team.name}</div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="tabular-nums">
                      {team.taskCompleted}/{team.taskTotal}
                    </span>
                    <span>·</span>
                    <span>
                      {team.memberCount} {t('agenteam.members')}
                    </span>
                  </div>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-1.5 py-px text-[10px]',
                    PHASE_STYLE[team.phase],
                  )}
                >
                  {t(`agenteam.phase.${team.phase}`)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 详情 */}
      <ScrollArea className="min-h-0 flex-1">
        {!detail ? (
          <div className="flex h-full items-center justify-center px-6 py-10 text-center text-xs text-muted-foreground">
            {t('agenteam.empty')}
          </div>
        ) : (
          <div className="space-y-3 p-3">
            {/* 队长卡片（captain 持久会话；点击跳转查看/干预队长决策） */}
            {detail.captainSessionId && (
              <div className="flex items-center gap-2.5 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-2">
                <HumationAvatar seed={detail.captainSessionId} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium text-foreground">{t('agenteam.captain')}</span>
                    <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] text-primary">
                      {t(`agenteam.phase.${detail.phase}`)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {detail.captainIsAuto ? 'Captain' : t('agenteam.captainUserSession')}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0"
                  title={t('agenteam.captainSession')}
                  onClick={() => navigate(`/task/${detail.captainSessionId}`)}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
              </div>
            )}

            {/* 审批卡片（staged） */}
            {detail.phase === 'staged' && (
              <PlanReviewCard team={detail} onApprove={handleApprove} onDiscard={handleDiscard} />
            )}

            {/* 汇总（completed） */}
            {detail.phase === 'completed' && detail.summary && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                  {t('agenteam.summary')}
                </div>
                <div className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">
                  {detail.summary}
                </div>
              </div>
            )}

            {/* 升级提示 */}
            {detail.escalated && (
              <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-500">
                <AlertTriangle className="size-3.5 shrink-0" />
                {t('agenteam.escalated')}
              </div>
            )}

            {/* 成员 */}
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">
                  {t('agenteam.members')}（{activeMembers.length}）
                </span>
                <div className="flex items-center gap-1">
                  {detail.phase === 'running' && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t('agenteam.halt')}
                      disabled={actionBusy}
                      onClick={handleHalt}
                    >
                      <Pause className="size-3.5" />
                    </Button>
                  )}
                  {detail.phase === 'halted' && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t('agenteam.resume')}
                      disabled={actionBusy}
                      onClick={handleResume}
                    >
                      <Play className="size-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-red-500 hover:text-red-600"
                    title={t('agenteam.delete')}
                    disabled={actionBusy}
                    onClick={() => setDeleteTarget(detail.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                {activeMembers.map((member) => (
                  <MemberCard
                    key={member.id}
                    member={member}
                    compact
                    activeTask={
                      member.status === 'working'
                        ? detail.tasks.find(
                            (task) => task.assignee === member.name && task.status === 'in_progress',
                          )
                        : undefined
                    }
                  />
                ))}
              </div>
            </section>

            {/* 任务 */}
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">
                  {t('agenteam.tasks')}（{detail.tasks.filter((task) => task.status === 'completed').length}/
                  {detail.tasks.length}）
                </span>
                {actionBusy && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
              </div>
              <TaskListView tasks={detail.tasks} members={detail.members} />
            </section>

            {/* 消息流 */}
            <section>
              <span className="mb-1.5 block text-xs font-medium text-foreground">{t('agenteam.messages')}</span>
              <MessageFeed messages={messages} members={activeMembers} />
            </section>
          </div>
        )}
      </ScrollArea>

      {/* 创建对话框 */}
      <CreateTeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(teamId) => {
          void refreshList();
          select(teamId);
        }}
      />

      {/* 删除确认 */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('agenteam.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('agenteam.deleteConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-500 text-white hover:bg-red-600" onClick={handleDelete}>
              {t('agenteam.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
