import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  MessageCirclePlus,
  Plug,
  AlarmClock,
  ListFilter,
  Search,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { OverlayType } from '../../types';
import type { TaskItem } from '../../types/api';
import { useStore } from '../../store';
import {
  Sidebar as UISidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarSeparator,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { UserMenu } from '../overlays/UserMenu';
import { ConfirmDialog } from '../overlays/ConfirmDialog';
import { useTasks } from '../../hooks/useTasks';

interface SidebarProps {
  onOpenOverlay: (overlay: OverlayType) => void;
}

export function Sidebar({ onOpenOverlay }: SidebarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { tasks, taskGroups, updateTask, deleteTask } = useTasks();

  // 任务项操作状态
  const [renameTask, setRenameTask] = useState<TaskItem | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);

  const handleRename = async () => {
    if (renameTask && renameTitle.trim()) {
      await updateTask(renameTask.id, { title: renameTitle.trim() });
      setRenameTask(null);
    }
  };

  const navItems: {
    icon: typeof MessageCirclePlus;
    labelKey: string;
    page: string;
    action?: 'new-task';
  }[] = [
    { icon: MessageCirclePlus, labelKey: 'sidebar.newTask', page: 'home', action: 'new-task' },
    { icon: Plug, labelKey: 'sidebar.pluginLibrary', page: 'plugins' },
    { icon: AlarmClock, labelKey: 'sidebar.automation', page: 'automation' },
  ];

  return (
    <>
    <UISidebar collapsible="icon">
      {/* Header: 品牌 + 折叠按钮 */}
      <SidebarHeader>
        <div className="flex items-center justify-between gap-2 px-1 py-1">
          <div className="flex min-w-0 items-center gap-2 group-data-[collapsible=icon]:hidden">
            <img src="/MOSS.png" alt="MOSS" className="size-6 shrink-0 rounded-md" />
            <span className="truncate text-sm font-semibold">MOSS</span>
          </div>
          <SidebarTrigger className="shrink-0 group-data-[collapsible=icon]:mx-auto" />
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      {/* 导航 */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {navItems.map((item) => {
              const Icon = item.icon;
              const label = t(item.labelKey);
              const isActive =
                (item.action === 'new-task' && pathname === '/') ||
                (`/${item.page}` === pathname && !item.action);
              return (
                <SidebarMenuItem key={item.labelKey}>
                  <SidebarMenuButton
                    isActive={isActive}
                    tooltip={label}
                    onClick={() => {
                      if (item.action === 'new-task') {
                        useStore.getState().setActiveTaskId(null);
                        useStore.getState().setActiveSession(null);
                        navigate('/');
                      } else {
                        navigate(`/${item.page}`);
                      }
                    }}
                  >
                    <Icon className="size-4" />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarSeparator />

        {/* 任务列表（折叠时隐藏） */}
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <div className="flex items-center justify-between px-2 pb-1">
            <SidebarGroupLabel className="h-auto p-0">{t('sidebar.taskList')}</SidebarGroupLabel>
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="icon-xs" title={t('sidebar.filter')}>
                <ListFilter />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                title={t('common.search')}
                onClick={() => onOpenOverlay('search')}
              >
                <Search />
              </Button>
            </div>
          </div>
          <SidebarGroupContent>
            <SidebarMenu>
              {taskGroups.map((group) => (
                <Collapsible key={group.id} defaultOpen={group.expanded}>
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton>
                        <ChevronRight className="size-4 transition-transform [[data-state=open]_&]:rotate-90" />
                        <span>{group.name}</span>
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {tasks.filter((task) => task.groupId === group.id).map((task) => (
                          <SidebarMenuItem key={task.id} className="group/item">
                            <SidebarMenuButton
                              isActive={pathname === `/task/${task.id}`}
                              size="sm"
                              onClick={() => navigate(`/task/${task.id}`)}
                            >
                              <span className="truncate pr-5">{task.title}</span>
                            </SidebarMenuButton>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  className="absolute right-0.5 top-1/2 z-10 -translate-y-1/2 opacity-0 transition-opacity group-hover/item:opacity-100 data-[state=open]:opacity-100"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreHorizontal className="size-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" side="right" sideOffset={4} collisionPadding={8}>
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setRenameTitle(task.title);
                                    setRenameTask(task);
                                  }}
                                >
                                  <Pencil className="size-3.5" />
                                  {t('sidebar.rename')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => setDeleteTaskId(task.id)}
                                >
                                  <Trash2 className="size-3.5" />
                                  {t('sidebar.delete')}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </SidebarMenuItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer: 用户菜单 */}
      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
    </UISidebar>

    {/* 重命名弹窗 */}
    <Dialog open={!!renameTask} onOpenChange={(o) => !o && setRenameTask(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sidebar.renameTask')}</DialogTitle>
          <DialogDescription>{t('sidebar.renameTaskDesc')}</DialogDescription>
        </DialogHeader>
        <Input
          value={renameTitle}
          onChange={(e) => setRenameTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleRename();
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setRenameTask(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => void handleRename()}
            disabled={!renameTitle.trim()}
          >
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* 删除确认弹窗 */}
    <ConfirmDialog
      open={!!deleteTaskId}
      onOpenChange={(o) => !o && setDeleteTaskId(null)}
      title={t('sidebar.deleteTask')}
      description={t('sidebar.deleteTaskDesc')}
      variant="danger"
      confirmText={t('sidebar.delete')}
      cancelText={t('common.cancel')}
      onConfirm={async () => {
        if (deleteTaskId) await deleteTask(deleteTaskId);
        setDeleteTaskId(null);
      }}
    />
    </>
  );
}
