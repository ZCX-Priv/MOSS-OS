import { useState, useCallback, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  MessageCirclePlus,
  Cable,
  AlarmClock,
  ListChecks,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  ArrowLeft,
  GripVertical,
  Check,
  CheckCheck,
  X,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  CircleAlert,
} from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import type { OverlayType } from '../../types';
import type { TaskItem, TaskGroup } from '../../types/api';
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
  SidebarTrigger,
  useSidebar,
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
import { Checkbox } from '@/components/ui/checkbox';
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
import { UserMenu } from '../overlays/UserMenu';
import { ConfirmDialog } from '../overlays/ConfirmDialog';
import { useTasks } from '../../hooks/useTasks';
import { api } from '../../api/http';
import { settingsNavItems, settingsSearchIndex } from '../pages/SettingsPage';

interface SidebarProps {
  onOpenOverlay: (overlay: OverlayType) => void;
}

export function Sidebar({ onOpenOverlay }: SidebarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { tasks, taskGroups, updateTask, deleteTask, reorderTasks, createTaskGroup, updateTaskGroup, deleteTaskGroup, reload } = useTasks();
  const isSettingsRoute = pathname.startsWith('/settings');
  const [settingsSearch, setSettingsSearch] = useState('');
  const { isMobile, setOpenMobile } = useSidebar();

  // 移动端点击导航后关闭 Sheet 抽屉，避免 z-50 遮罩持续覆盖屏幕
  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  // 任务项操作状态
  const [renameTask, setRenameTask] = useState<TaskItem | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);

  // 分组管理状态：受控折叠 + 新建/重命名/删除
  const [groupExpanded, setGroupExpanded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const g of taskGroups) initial[g.id] = g.expanded ?? true;
    return initial;
  });
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [renameGroup, setRenameGroup] = useState<TaskGroup | null>(null);
  const [renameGroupName, setRenameGroupName] = useState('');
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  // 删除分组时是否连同组内所有任务一并删除（否则任务迁回默认分组）
  const [deleteGroupAlsoTasks, setDeleteGroupAlsoTasks] = useState(false);

  const toggleGroup = (groupId: string) => {
    setGroupExpanded((prev) => ({ ...prev, [groupId]: !(prev[groupId] ?? true) }));
  };

  const handleCreateGroup = async () => {
    if (newGroupName.trim()) {
      await createTaskGroup(newGroupName.trim());
      setNewGroupName('');
    }
    setNewGroupOpen(false);
  };

  const handleRenameGroup = async () => {
    if (renameGroup && renameGroupName.trim()) {
      await updateTaskGroup(renameGroup.id, { name: renameGroupName.trim() });
      setRenameGroup(null);
    }
  };

  const handleDeleteGroup = async () => {
    if (deleteGroupId) {
      // 勾选：连组内任务（含 session 文件）一并删除；未勾选：组内任务迁回默认分组
      await deleteTaskGroup(deleteGroupId, 'default', deleteGroupAlsoTasks);
      setDeleteGroupId(null);
    }
  };

  const handleRename = async () => {
    if (renameTask && renameTitle.trim()) {
      await updateTask(renameTask.id, { title: renameTitle.trim() });
      setRenameTask(null);
    }
  };

  // 管理模式（批量选择 + 拖拽排序）
  const [manageMode, setManageMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const visibleTaskIds = tasks.map((t) => t.id);
  const allSelected = visibleTaskIds.length > 0 && visibleTaskIds.every((id) => selectedIds.has(id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(visibleTaskIds));
  };

  const handleBatchDelete = async () => {
    // 逐个直调 API + 本地移除，最后统一刷新（避免 N 次全量加载；同时感知空文件夹分组的自动销毁）
    for (const id of selectedIds) {
      try {
        await api.deleteTask(id);
        useStore.getState().removeTask(id);
      } catch (err) {
        console.warn('batch deleteTask failed:', err);
      }
    }
    setSelectedIds(new Set());
    setBatchDeleteOpen(false);
    await reload();
  };

  // 跨组拖拽碰撞检测：指针下有任务（sortable item）时优先任务（保证组内精确排序），
  // 否则命中组容器 droppable（含空组），使任务可拖入任意分组区域
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    const taskCollision = pointerCollisions.find((c) => !String(c.id).startsWith('group:'));
    if (taskCollision) return [taskCollision];
    return pointerCollisions;
  }, []);

  // 统一拖拽结束：同组 → 精确排序；异组 → 移组（后端置顶 + session 文件搬移）
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const state = useStore.getState();
    const activeTask = state.tasks.find((t) => t.id === activeId);
    if (!activeTask) return;

    let targetGroupId: string;
    let overTaskId: string | null = null;
    if (overId.startsWith('group:')) {
      targetGroupId = overId.slice('group:'.length);
    } else {
      const overTask = state.tasks.find((t) => t.id === overId);
      if (!overTask) return;
      targetGroupId = overTask.groupId;
      overTaskId = overTask.id;
    }

    if (targetGroupId === activeTask.groupId) {
      // 同组：over 必须是任务且非自身，做组内精确排序
      if (!overTaskId || overTaskId === activeId) return;
      const groupTaskIds = state.tasks.filter((t) => t.groupId === targetGroupId).map((t) => t.id);
      const newOrderIds = arrayMove(groupTaskIds, groupTaskIds.indexOf(activeId), groupTaskIds.indexOf(overTaskId));
      // 乐观更新：立即按新顺序重排该组任务，避免松手回弹闪烁
      const inGroup = state.tasks.filter((t) => t.groupId === targetGroupId);
      const byId = new Map(inGroup.map((t) => [t.id, t]));
      const reordered = newOrderIds.map((id, idx) => ({ ...byId.get(id)!, order: idx }));
      const others = state.tasks.filter((t) => t.groupId !== targetGroupId);
      useStore.getState().setTasks([...others, ...reordered]);
      // 持久化（后端返回后再次 setTasks 校正）
      void reorderTasks(newOrderIds);
    } else {
      // 跨组移动：updateTask 移组（后端 order 置顶 + session 文件搬移；store 单点更新，渲染按 groupId 过滤即时生效）
      void updateTask(activeId, { groupId: targetGroupId });
    }
  };

  const navItems: {
    icon: typeof MessageCirclePlus;
    labelKey: string;
    page: string;
    action?: 'new-task';
  }[] = [
    { icon: MessageCirclePlus, labelKey: 'sidebar.newTask', page: 'home', action: 'new-task' },
    { icon: Cable, labelKey: 'sidebar.pluginLibrary', page: 'plugins' },
    { icon: AlarmClock, labelKey: 'sidebar.automation', page: 'automation' },
  ];

  const settingsSearchResults = settingsSearch.trim()
    ? settingsSearchIndex
        .map((item) => {
          const navItem = settingsNavItems.find((n) => n.id === item.section);
          return {
            ...item,
            label: t(item.labelKey),
            description: item.descriptionKey ? t(item.descriptionKey) : '',
            sectionLabel: navItem ? t(navItem.labelKey) : '',
            SectionIcon: navItem?.Icon,
          };
        })
        .filter((item) => {
          const q = settingsSearch.toLowerCase();
          return (
            item.label.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q) ||
            item.sectionLabel.toLowerCase().includes(q)
          );
        })
    : null;

  return (
    <>
    <UISidebar collapsible="icon">
      {/* Header: 品牌 + 折叠按钮 */}
      <SidebarHeader>
        {isSettingsRoute ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={t('settings.backToApp')}
                onClick={() => { closeMobile(); navigate('/'); }}
              >
                <ArrowLeft className="size-4" />
                <span>{t('settings.backToApp')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : (
          <div className="flex items-center justify-between gap-2 px-1 py-1">
            <div className="flex min-w-0 items-center gap-2 group-data-[collapsible=icon]:hidden">
              <img src="/MOSS.png" alt="MOSS" className="size-6 shrink-0 rounded-md" />
              <span className="truncate text-sm font-semibold">MOSS</span>
            </div>
            <SidebarTrigger className="shrink-0 group-data-[collapsible=icon]:mx-auto" />
          </div>
        )}
      </SidebarHeader>

      {/* 导航 */}
      <SidebarContent>
        {isSettingsRoute ? (
          <SidebarGroup>
            <SidebarGroupContent>
              <div className="px-2 pb-1 group-data-[collapsible=icon]:hidden">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder={t('settings.searchPlaceholder')}
                    value={settingsSearch}
                    onChange={(e) => setSettingsSearch(e.target.value)}
                    className="h-8 pl-8 text-sm"
                  />
                </div>
              </div>
              <SidebarMenu>
                {settingsSearchResults ? (
                  settingsSearchResults.length > 0 ? (
                    settingsSearchResults.map((result) => (
                      <SidebarMenuItem key={`${result.section}-${result.labelKey}`}>
                        <button
                          className="flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground h-8"
                          onClick={() => {
                            closeMobile();
                            navigate(`/settings/${result.section}`);
                            setSettingsSearch('');
                          }}
                        >
                          {result.SectionIcon && <result.SectionIcon className="size-4 shrink-0" />}
                          <span className="flex-1 truncate">{result.label}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{result.sectionLabel}</span>
                        </button>
                      </SidebarMenuItem>
                    ))
                  ) : (
                    <li className="px-2 py-4 text-center text-xs text-muted-foreground">
                      {t('settings.noResults')}
                    </li>
                  )
                ) : (
                  settingsNavItems.map((item) => {
                    const isActive = pathname === `/settings/${item.id}`;
                    const label = t(item.labelKey);
                    return (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          isActive={isActive}
                          tooltip={label}
                          onClick={() => { closeMobile(); navigate(`/settings/${item.id}`); }}
                        >
                          <item.Icon className="size-4" />
                          <span>{label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <>
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
                      closeMobile();
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

        {/* 任务列表（折叠时隐藏） */}
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <div className="flex items-center justify-between px-2 pb-1">
            <SidebarGroupLabel className="h-auto p-0">{t('sidebar.taskList')}</SidebarGroupLabel>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-xs"
                title={t('sidebar.newGroup')}
                onClick={() => setNewGroupOpen(true)}
              >
                <FolderPlus />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                title={t('sidebar.manage')}
                onClick={() => { setManageMode((v) => !v); setSelectedIds(new Set()); }}
                className={cn(manageMode && 'bg-muted text-foreground')}
              >
                <ListChecks />
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
            {manageMode && (
              <div className="flex items-center gap-1 px-2 pb-1">
                <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={toggleSelectAll}>
                  <CheckCheck className="size-3.5" />
                  {allSelected ? t('sidebar.deselectAll') : t('sidebar.selectAll')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                  disabled={selectedIds.size === 0}
                  onClick={() => setBatchDeleteOpen(true)}
                >
                  <Trash2 className="size-3.5" />
                  {t('sidebar.deleteSelected')}
                </Button>
                <div className="ml-auto flex items-center gap-1">
                  {selectedIds.size > 0 && (
                    <span className="flex size-5 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                      {selectedIds.size}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title={t('sidebar.exitManage')}
                    onClick={() => { setManageMode(false); setSelectedIds(new Set()); }}
                  >
                    <X />
                  </Button>
                </div>
              </div>
            )}
            <SidebarMenu>
              {/* 单一顶层 DndContext：任务可跨组拖拽（同组精确排序 / 异组移组置顶） */}
              <DndContext
                sensors={sensors}
                collisionDetection={collisionDetection}
                onDragEnd={handleDragEnd}
              >
              {taskGroups
                // 默认分组为空时隐藏整个条目（常驻分组，持有任务才显示）
                .filter((group) => group.id !== 'default' || tasks.some((task) => task.groupId === 'default'))
                .map((group) => {
                const groupTasks = tasks.filter((task) => task.groupId === group.id);
                const groupTaskIds = groupTasks.map((t) => t.id);
                const expanded = groupExpanded[group.id] ?? true;
                const GroupIcon = expanded ? FolderOpen : Folder;
                // 默认分组为常驻分组：文案固定且随语言本地化
                const groupLabel = group.id === 'default' ? t('sidebar.defaultGroup') : group.name;
                return (
                  <Collapsible
                    key={group.id}
                    open={expanded}
                    onOpenChange={() => toggleGroup(group.id)}
                    className="anim-list animate-in fade-in duration-150"
                  >
                    <SidebarMenuItem>
                      <div className="group/group-item relative">
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton>
                            <GroupIcon className="size-4 shrink-0 text-muted-foreground" />
                            <span className="truncate pr-6">{groupLabel}</span>
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        {group.id !== 'default' && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="absolute right-0 top-1/2 z-10 size-6 -translate-y-1/2 opacity-0 transition-opacity group-hover/group-item:opacity-100 data-[state=open]:opacity-100"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="size-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" side="bottom" sideOffset={4} collisionPadding={8}>
                              <DropdownMenuItem
                                onSelect={() => { setRenameGroupName(group.name); setRenameGroup(group); }}
                              >
                                <Pencil className="size-3.5" />
                                {t('sidebar.renameGroup')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => { setDeleteGroupAlsoTasks(false); setDeleteGroupId(group.id); }}
                              >
                                <Trash2 className="size-3.5" />
                                {t('sidebar.deleteGroup')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                      <CollapsibleContent>
                        {/* 组级 droppable：拖入组内任意位置（含空白/空组）即移入该组 */}
                        <GroupDropZone groupId={group.id}>
                          <SidebarMenuSub className="mr-0 pr-0">
                            <SortableContext items={groupTaskIds} strategy={verticalListSortingStrategy}>
                              {groupTasks.map((task) => (
                                <TaskRow
                                  key={task.id}
                                  task={task}
                                  manageMode={manageMode}
                                  isSelected={selectedIds.has(task.id)}
                                  onToggleSelect={toggleSelect}
                                  onNavigate={(id) => { closeMobile(); navigate(`/task/${id}`); }}
                                  onRename={(tk) => { setRenameTitle(tk.title); setRenameTask(tk); }}
                                  onDelete={(id) => setDeleteTaskId(id)}
                                />
                              ))}
                            </SortableContext>
                          </SidebarMenuSub>
                        </GroupDropZone>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
              </DndContext>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
          </>
        )}
      </SidebarContent>

      {/* Footer: 用户菜单（设置模式下隐藏） */}
      {!isSettingsRoute && (
        <SidebarFooter>
          <UserMenu />
        </SidebarFooter>
      )}
    </UISidebar>

    {/* 新建分组弹窗 */}
    <Dialog open={newGroupOpen} onOpenChange={setNewGroupOpen}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('sidebar.newGroup')}</DialogTitle>
          <DialogDescription>{t('sidebar.newGroupDesc')}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreateGroup();
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setNewGroupOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleCreateGroup()} disabled={!newGroupName.trim()}>
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* 重命名分组弹窗 */}
    <Dialog open={!!renameGroup} onOpenChange={(o) => !o && setRenameGroup(null)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('sidebar.renameGroup')}</DialogTitle>
          <DialogDescription>{t('sidebar.renameGroupDesc')}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={renameGroupName}
          onChange={(e) => setRenameGroupName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleRenameGroup();
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setRenameGroup(null)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleRenameGroup()} disabled={!renameGroupName.trim()}>
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* 删除分组确认弹窗：可选连组内任务一并删除，或迁回默认分组 */}
    <AlertDialog
      open={!!deleteGroupId}
      onOpenChange={(o) => {
        if (!o) setDeleteGroupId(null);
      }}
    >
      <AlertDialogContent size="md">
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <CircleAlert className="size-5 shrink-0 translate-y-0.5 text-destructive" />
            <div className="flex flex-col gap-1">
              <AlertDialogTitle>{t('sidebar.deleteGroup')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('sidebar.deleteGroupDesc')}{' '}
                {deleteGroupAlsoTasks ? t('sidebar.deleteGroupPurgeDesc') : t('sidebar.deleteGroupMoveDesc')}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm select-none">
          <Checkbox
            checked={deleteGroupAlsoTasks}
            onCheckedChange={(v) => setDeleteGroupAlsoTasks(v === true)}
          />
          {t('sidebar.deleteGroupAlsoDeleteTasks')}
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleDeleteGroup();
            }}
            className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20"
          >
            {t('sidebar.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* 重命名弹窗 */}
    <Dialog open={!!renameTask} onOpenChange={(o) => !o && setRenameTask(null)}>
      <DialogContent size="sm">
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

    {/* 批量删除确认弹窗 */}
    <ConfirmDialog
      open={batchDeleteOpen}
      onOpenChange={(o) => !o && setBatchDeleteOpen(false)}
      title={t('sidebar.batchDeleteTask')}
      description={t('sidebar.batchDeleteTaskDesc', { count: selectedIds.size })}
      variant="danger"
      confirmText={t('sidebar.delete')}
      cancelText={t('common.cancel')}
      onConfirm={handleBatchDelete}
    />
    </>
  );
}

interface TaskRowProps {
  task: TaskItem;
  manageMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onNavigate: (id: string) => void;
  onRename: (task: TaskItem) => void;
  onDelete: (id: string) => void;
}

function TaskRow({
  task,
  manageMode,
  isSelected,
  onToggleSelect,
  onNavigate,
  onRename,
  onDelete,
}: TaskRowProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  // 状态指示器：运行中（转圈）/ 出错（红警示），空闲不显示；WS 事件流驱动
  const sid = task.sessionId ?? task.id;
  const generating = useStore((s) => s.generatingBySession[sid] ?? false);
  const errored = useStore((s) => s.errorBySession[sid] ?? false);
  // 仅垂直拖拽：剥离 x 分量（列表语义，跨组也是纵向移入）
  const restrictedTransform = transform ? { ...transform, x: 0 } : null;
  const style: CSSProperties = {
    transform: CSS.Transform.toString(restrictedTransform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  if (manageMode) {
    return (
      <li
        ref={setNodeRef}
        style={style}
        className="anim-list animate-in fade-in duration-150 group/menu-item relative group/item flex w-full min-w-0 items-center gap-1.5"
      >
        <button
          type="button"
          onClick={() => onToggleSelect(task.id)}
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
            isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
          )}
        >
          {isSelected && <Check className="size-3" />}
        </button>
        <button
          type="button"
          onClick={() => onToggleSelect(task.id)}
          className="flex h-8 min-w-0 flex-1 items-center overflow-hidden rounded-md px-2 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <span className="truncate">{task.title}</span>
        </button>
        <button
          type="button"
          className="flex size-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
      </li>
    );
  }

  return (
    <li ref={setNodeRef} style={style} className="anim-list animate-in fade-in duration-150 group/menu-item relative group/item">
      <SidebarMenuButton
        isActive={pathname === `/task/${task.id}`}
        onClick={() => onNavigate(task.id)}
      >
        <span className="truncate pr-5">{task.title}</span>
      </SidebarMenuButton>
      {/* 拖拽手柄（跨组移动/组内排序）：hover 显示；绑独立手柄而非整行，避免 dnd-kit listeners 吞掉点击导航 */}
      <button
        type="button"
        aria-label={t('sidebar.dragHandle')}
        className="absolute right-11 top-1/2 z-[5] flex size-4 -translate-y-1/2 cursor-grab items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-foreground active:cursor-grabbing group-hover/item:opacity-100"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>
      {/* 状态指示器：运行中/出错时常显，hover 时被菜单按钮覆盖；标题 pr-5 为其预留空间 */}
      <span
        className="pointer-events-none absolute right-0.25 top-1/2 z-[5] flex size-4 -translate-y-1/2 items-center justify-center"
        aria-label={generating ? t('sidebar.statusRunning') : errored ? t('sidebar.statusError') : undefined}
      >
        {generating ? (
          <Loader2 className="size-3.5 animate-spin text-primary" />
        ) : errored ? (
          <CircleAlert className="size-3.5 text-destructive" />
        ) : null}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute right-0 top-1/2 z-10 -translate-y-1/2 opacity-0 transition-opacity group-hover/item:opacity-100 data-[state=open]:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" sideOffset={4} collisionPadding={8}>
          <DropdownMenuItem onSelect={() => onRename(task)}>
            <Pencil className="size-3.5" />
            {t('sidebar.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(task.id)}>
            <Trash2 className="size-3.5" />
            {t('sidebar.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/**
 * 组级 droppable 容器：把分组任务列表区域注册为 drop 目标（id = `group:<groupId>`），
 * 拖入组内任意位置（任务上/空白处/空组）均触发移组；悬停时高亮提示可放置。
 */
function GroupDropZone({ groupId, children }: { groupId: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `group:${groupId}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-md -mx-1 px-1 transition-colors',
        isOver && 'bg-primary/10',
      )}
    >
      {children}
    </div>
  );
}
