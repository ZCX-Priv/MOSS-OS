import { useState, useEffect, useCallback, memo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ChevronRight,
  FileText,
  Info,
  List,
  PanelRight,
  Plus,
  Loader2,
  HelpCircle,
  Atom,
  Terminal,
  X,
  Copy,
  Undo2,
  FileWarning,
  Sparkles,
  ListTodo,
  ShieldCheck,
  Circle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { resolveToolIcon } from '@/lib/tool-icons';
import type { OverlayType } from '../../types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useIsMobile } from '@/hooks/use-mobile';
import { useResizable } from '@/hooks/use-resizable';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToHorizontalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TaskInput } from '../shared/TaskInput';
import { TodoProgressCard } from '../shared/TodoProgressCard';
import { AskPromptCard } from '../shared/AskPromptCard';
import { ConfirmPromptCard } from '../shared/ConfirmPromptCard';
import { TerminalView } from '../shared/TerminalView';
import { ControlHub } from '../shared/ControlHub';
import { StatsBar } from '../shared/StatsBar';
import { useStore } from '../../store';
import { useTask } from '../../hooks/useTask';
import { api } from '../../api/http';
import { wsClient } from '../../api/ws';
import type { TaskMessage, TodoItem, SidebarTab } from '../../types/api';

// 稳定引用的空数组，避免 useStore 选择器每次返回新 [] 触发 useSyncExternalStore 无限循环
const EMPTY_MESSAGES: TaskMessage[] = [];
const EMPTY_TODOS: TodoItem[] = [];

// 单条消息正文渲染上限：超长内容（如 base64/大文件摘录）截断渲染，防止一次性布局卡死滚动
const MAX_RENDER_CHARS = 6000;

// 根据当前小时返回问候语 i18n key
function getGreetingKey(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 9) return 'task.greeting.morning';       // 早上好
  if (h >= 9 && h < 11) return 'task.greeting.forenoon';      // 上午好
  if (h >= 11 && h < 14) return 'task.greeting.noon';         // 中午好
  if (h >= 14 && h < 18) return 'task.greeting.afternoon';    // 下午好
  if (h >= 18 && h < 23) return 'task.greeting.evening';      // 晚上好
  return 'task.greeting.lateNight';                            // 夜深了（23-4）
}

interface TaskPageProps {
  onOpenOverlay: (overlay: OverlayType) => void;
}

export function TaskPage({ onOpenOverlay }: TaskPageProps) {
  const { t } = useTranslation();
  const { taskId = '' } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const isMobile = useIsMobile();

  // 右侧面板拖拽调宽（仅桌面端内嵌 aside）
  const rightResize = useResizable({
    side: 'left',
    min: 240,
    max: 560,
    onChange: setRightPanelWidth,
  });

  // 右侧面板标签页拖拽排序
  const tabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const handleTabDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    reorderSidebarTabs(String(active.id), String(over.id));
  };

  const messages = useStore((s) => s.messagesBySession[taskId] ?? EMPTY_MESSAGES);
  const isGenerating = useStore((s) => s.generatingBySession[taskId] ?? false);
  const task = useStore((s) => s.tasks.find((tk) => tk.id === taskId));
  const todos = useStore((s) => s.todosBySession[taskId] ?? EMPTY_TODOS);
  const pendingAsks = useStore((s) => s.pendingAsks);
  const pendingConfirms = useStore((s) => s.pendingConfirms);
  // 当前会话激活的 skill 模式（Badge 展示 + 一键退出）
  const activeSkill = useStore((s) => s.activeSkillBySession[taskId]);
  // 当前会话 run 统计（中控岛下方指标栏）与中控岛展开模块
  const runStats = useStore((s) => s.runStatsBySession[taskId]);
  const hubActiveModule = useStore((s) => s.hubActiveModuleBySession[taskId]);
  const setHubActiveModule = useStore((s) => s.setHubActiveModule);

  // ===== 消息撤回（截断）状态机 =====
  /** 待确认的撤回目标（用户消息） */
  const [truncateTarget, setTruncateTarget] = useState<TaskMessage | null>(null);
  // ===== 滚动控制 =====
  /** 滚动容器 ref（.task-scroll-area） */
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 本会话是否已执行过首次滚底（历史加载完成后强制定位最新消息；切会话重置） */
  const hasAutoScrolledRef = useRef(false);
  /** 预览加载中 */
  const [truncateLoading, setTruncateLoading] = useState(false);
  /** 预览结果 */
  const [truncatePreview, setTruncatePreview] = useState<{
    messagesToRemove: Array<{ index: number; role: string; content: string }>;
    fileChanges: Array<{ absPath: string; operation: string; toolName: string; timestamp: string }>;
  } | null>(null);
  /** 执行中 */
  const [truncating, setTruncating] = useState(false);
  const context = useStore((s) => s.contextBySession[taskId]);
  const sidebarTabs = useStore((s) => s.sidebarTabs);
  const activeSidebarTabId = useStore((s) => s.activeSidebarTabId);
  const addSidebarTab = useStore((s) => s.addSidebarTab);
  const removeSidebarTab = useStore((s) => s.removeSidebarTab);
  const setActiveSidebarTab = useStore((s) => s.setActiveSidebarTab);
  const reorderSidebarTabs = useStore((s) => s.reorderSidebarTabs);
  const toolIconMap = useStore((s) => s.toolIconMap);
  const { sendMessage, abort } = useTask();

  // 当前活跃标签对象
  const activeTab = sidebarTabs.find((t) => t.id === activeSidebarTabId) ?? sidebarTabs[0];
  // 下拉菜单只显示当前标签栏中未打开的标签页类型；两类都已打开时禁用加号按钮
  const hasSummaryTab = sidebarTabs.some((tab) => tab.type === 'summary');
  const hasTerminalTab = sidebarTabs.some((tab) => tab.type === 'terminal');
  const allTabTypesOpen = hasSummaryTab && hasTerminalTab;

  // 挂载/切换会话时加载历史 + todos + context。
  // 历史总是拉取（切回旧会话时同步后台新产生的消息）；仅当非流式生成中才整体替换，
  // 防止覆盖流式 UI 状态。store 已有消息时先显示旧值，拉到后替换，无闪烁。
  useEffect(() => {
    if (!taskId) return; // 空 taskId 守卫：避免污染 store 的 activeSessionId/activeTaskId
    hasAutoScrolledRef.current = false; // 会话切换：重置首次滚底标记
    void api
      .getSessionHistory(taskId)
      .then((resp) => {
        if (resp.messages && resp.messages.length > 0) {
          if (!useStore.getState().generatingBySession[taskId]) {
            useStore.getState().setMessages(taskId, resp.messages);
          }
        }
        // 刷新后恢复 skill 模式 Badge（greet 不重复注入）
        if (resp.activeSkill) {
          useStore.getState().setActiveSkill(taskId, { name: resp.activeSkill.name });
        }
        // 刷新后恢复会话级权限模式（PermissionModeSelector 徽章回显）
        if (resp.permissionMode) {
          useStore.getState().setPermissionMode(resp.permissionMode, taskId);
        }
        // 刷新后恢复最近一次 run 统计（中控岛指标栏）
        useStore.getState().setRunStats(taskId, resp.lastRunStats);
      })
      .catch(() => {
        // 后端未就绪或会话不存在，静默
      });
    // 加载 todos（刷新后侧边栏 todo 卡片恢复）
    void api
      .listTodos(taskId)
      .then((resp) => {
        if (resp.todos) {
          useStore.getState().setTodos(taskId, resp.todos);
        }
      })
      .catch(() => {});
    // 加载上下文文件轨迹（刷新后右侧面板恢复）
    void api
      .getSessionContext(taskId)
      .then((ctx) => {
        useStore.getState().setContext(taskId, {
          files: ctx.files,
          totalTokens: ctx.totalTokens,
          maxTokens: ctx.maxTokens,
        });
      })
      .catch(() => {});
    // 设置当前活跃 session
    useStore.getState().setActiveSession(taskId);
    useStore.getState().setActiveTaskId(taskId);
    // 同步后端 ConnectionState，确保异步事件推送到正确连接
    wsClient.send({ type: 'session.subscribe', sessionId: taskId });

    return () => {
      // 卸载时若 activeSessionId 仍指向自己，清除之，防止 useWebSocket 误用旧 session。
      // 注意：不停止后端 agent.run（任务可在后台继续），仅防状态污染。
      const cur = useStore.getState().activeSessionId;
      if (cur === taskId) {
        useStore.getState().setActiveSession(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // ===== 自动滚动 =====
  // 首次（历史加载完成）：强制定位到最新消息；此后仅在用户已处于底部附近时跟随滚底
  // （流式追加/新消息），用户上翻查看历史时不打扰。
  const lastMessage = messages[messages.length - 1];
  const lastContentLength = lastMessage?.content.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;
    if (!hasAutoScrolledRef.current) {
      el.scrollTop = el.scrollHeight;
      hasAutoScrolledRef.current = true;
      return;
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, lastContentLength, isGenerating]);

  const contextFiles = context?.files ?? [];
  const totalTokens = context?.totalTokens ?? 0;
  const maxTokens = context?.maxTokens ?? 1;
  const contextPercent = maxTokens > 0 ? Math.round((totalTokens / maxTokens) * 100) : 0;

  // 空状态：发送消息后创建任务并跳转；任务态：直接发送到当前 session
  const handleSend = useCallback(
    async (text: string) => {
      if (taskId) {
        sendMessage(text, { taskId });
      } else {
        const newTaskId = await sendMessage(text);
        if (newTaskId) navigate(`/task/${newTaskId}`);
      }
    },
    [taskId, sendMessage, navigate],
  );

  // ===== 消息撤回流程 =====
  /** 点击撤回按钮：拉取预览并弹确认框 */
  const handleTruncateClick = useCallback(
    async (message: TaskMessage) => {
      if (!taskId || isGenerating) return;
      setTruncateTarget(message);
      setTruncatePreview(null);
      setTruncateLoading(true);
      try {
        const resp = await api.previewTruncate(taskId, message.timestamp, message.content);
        setTruncatePreview({ messagesToRemove: resp.messagesToRemove, fileChanges: resp.fileChanges });
      } catch {
        // 预览失败（后端未就绪/旧消息无时间戳）：仍允许执行（只删消息）
        setTruncatePreview({ messagesToRemove: [], fileChanges: [] });
      } finally {
        setTruncateLoading(false);
      }
    },
    [taskId, isGenerating],
  );

  /** 确认撤回：执行截断（软删除 + 文件回滚），toast 提供恢复入口 */
  const handleTruncateConfirm = useCallback(async () => {
    if (!taskId || !truncateTarget) return;
    setTruncating(true);
    try {
      const resp = await api.truncateSession(taskId, truncateTarget.timestamp, truncateTarget.content);
      const hasFiles = resp.rolledBackFiles > 0;
      toast(t('task.truncateDone', { count: resp.removedCount, files: resp.rolledBackFiles }), {
        description: hasFiles ? t('task.truncateFilesRolled', { files: resp.rolledBackFiles }) : undefined,
        action: {
          label: t('task.truncateRestore'),
          onClick: async () => {
            try {
              await api.restoreTruncate(taskId);
            } catch {
              toast.error(t('task.truncateRestoreFailed'));
            }
          },
        },
        duration: 15000,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('task.truncateFailed'));
    } finally {
      setTruncating(false);
      setTruncateTarget(null);
      setTruncatePreview(null);
    }
  }, [taskId, truncateTarget, t]);

  /** 复制消息文本 */
  const handleCopyMessage = useCallback((content: string) => {
    void navigator.clipboard.writeText(content).then(
      () => toast.success(t('task.messageCopied')),
      () => toast.error(t('task.messageCopyFailed')),
    );
  }, [t]);

  // 右侧面板内容（移动端 Sheet 与桌面端 aside 共用，避免重复 JSX）
  const rightPanelContent = (
    <>
      {/* Panel Header：标签页栏 + 加号下拉菜单 */}
      <div className="flex h-12 items-center gap-2 border-b border-border px-3">
        {/* 标签页栏 */}
        <DndContext
          sensors={tabSensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
          onDragEnd={handleTabDragEnd}
        >
          <SortableContext items={sidebarTabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
            <div className="flex flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar">
              {sidebarTabs.map((tab) => (
                <SortableTab
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTab?.id}
                  canShowClose={sidebarTabs.length > 1}
                  onSelect={setActiveSidebarTab}
                  onRemove={removeSidebarTab}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        {/* 加号下拉菜单：新建标签页（仅显示当前标签栏中未打开的类型） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('task.add')}
              disabled={allTabTypesOpen}
            >
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4} collisionPadding={8}>
            {!hasSummaryTab && (
              <DropdownMenuItem
                onSelect={() => addSidebarTab('summary', 'task.taskSummary')}
              >
                <List className="size-4" />
                {t('task.taskSummary')}
              </DropdownMenuItem>
            )}
            {!hasTerminalTab && (
              <DropdownMenuItem
                onSelect={() => addSidebarTab('terminal', 'terminal.title')}
              >
                <Terminal className="size-4" />
                {t('terminal.title')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 标签内容路由 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {activeTab?.type === 'summary' && (
          <>
            <TodoProgressCard
              todos={todos}
              variant="sidebar"
              className="border-b border-border"
            />
            {/* Context Section */}
            <div className="flex flex-1 flex-col gap-2 overflow-hidden p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <span>{t('task.context')}</span>
                  <Info className="size-3 text-muted-foreground" />
                </div>
                <Button variant="ghost" size="xs">
                  {t('task.compress')}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Progress value={contextPercent} className="flex-1" />
                <span className="text-xs text-muted-foreground">{contextPercent}%</span>
              </div>
              <Tabs defaultValue="files" className="flex flex-1 flex-col gap-2 overflow-hidden">
                <TabsList>
                  <TabsTrigger value="files">{t('task.files')}</TabsTrigger>
                  <TabsTrigger value="others">{t('task.others')}</TabsTrigger>
                </TabsList>
                <TabsContent value="files" className="flex-1 min-h-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="flex flex-col gap-0.5">
                      {contextFiles.length === 0 ? (
                        <span className="px-2 py-4 text-xs text-muted-foreground">
                          {t('task.noContextFiles')}
                        </span>
                      ) : (
                        contextFiles.map((file) => (
                          <Button
                            key={file.path}
                            variant="ghost"
                            size="xs"
                            className="justify-start gap-1.5 font-normal"
                          >
                            <FileText className="size-3.5 text-primary" />
                            <span className="truncate">{file.path}</span>
                          </Button>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="others" className="flex-1 min-h-0">
                  <div className="px-2 py-4 text-xs text-muted-foreground">
                    {t('task.noOthers')}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
        {activeTab?.type === 'terminal' && (
          <TerminalView toolCallId={activeTab.toolCallId} />
        )}
      </div>
    </>
  );

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Task Area */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {/* Task Header — 移动端：三栏 grid（左 trigger + 居中标题 + 右按钮） */}
        <div className="grid h-12 grid-cols-3 items-center px-3 md:hidden">
          <SidebarTrigger />
          <h2 className="truncate text-center text-sm font-medium text-foreground">
            {task?.title ?? t('task.newTask')}
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            title={rightPanelOpen ? t('task.collapseRightPanel') : t('task.expandRightPanel')}
          >
            <PanelRight />
          </Button>
        </div>
        {/* Task Header — 桌面端：标题 + 右按钮 */}
        <div className="hidden h-12 items-center justify-between px-4 md:flex">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-foreground">
              {task?.title ?? t('task.newTask')}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            title={rightPanelOpen ? t('task.collapseRightPanel') : t('task.expandRightPanel')}
          >
            <PanelRight />
          </Button>
        </div>

        {/* Task Messages */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto task-scroll-area">
          <div className="flex min-h-full flex-col gap-4 p-4">
            {messages.length === 0 && !isGenerating && (
              <div className="flex flex-1 flex-col items-center justify-center gap-6">
                <img src="/MOSS.png" alt="MOSS" className="size-16 rounded-2xl object-cover" />
                <p className="text-lg text-muted-foreground">
                  {t(getGreetingKey())}{t('task.greeting.prompt')}
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <div className="message-cv" key={msg.id}>
                <MessageBubble
                  message={msg}
                  todos={todos}
                  toolIconMap={toolIconMap}
                  truncateDisabled={isGenerating}
                  onTruncate={handleTruncateClick}
                  onCopy={handleCopyMessage}
                />
              </div>
            ))}
            {isGenerating && messages[messages.length - 1]?.role !== 'assistant' && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span className="text-sm">{t('task.thinking')}</span>
              </div>
            )}
            {/* ask/confirm 卡片已迁移至任务输入框上方的中控岛（ControlHub 权限模块） */}
          </div>
        </div>

        {/* 消息撤回确认弹窗（预览卡片：将删除的消息 + 将回滚的文件变更） */}
        <Dialog
          open={truncateTarget !== null}
          onOpenChange={(open) => {
            if (!open && !truncating) {
              setTruncateTarget(null);
              setTruncatePreview(null);
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('task.truncateTitle')}</DialogTitle>
              <DialogDescription>
                {t('task.truncateDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 text-sm">
              {truncateLoading ? (
                <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-xs">{t('task.truncateLoading')}</span>
                </div>
              ) : (
                <>
                  {/* 将删除的消息 */}
                  <div>
                    <div className="mb-1 text-xs font-medium text-foreground">
                      {t('task.truncateMessages', { count: truncatePreview?.messagesToRemove.length ?? 0 })}
                    </div>
                    <div className="max-h-32 overflow-y-auto rounded-md border border-border p-2">
                      {truncatePreview && truncatePreview.messagesToRemove.length > 0 ? (
                        truncatePreview.messagesToRemove.map((m) => (
                          <div key={m.index} className="truncate py-0.5 text-xs text-muted-foreground">
                            <span className="mr-1 opacity-60">[{m.role}]</span>
                            {m.content}
                          </div>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">{t('task.truncateNoPreview')}</span>
                      )}
                    </div>
                  </div>
                  {/* 将回滚的文件变更 */}
                  <div>
                    <div className="mb-1 flex items-center gap-1 text-xs font-medium text-foreground">
                      <FileWarning className="size-3.5 text-amber-500" />
                      {t('task.truncateFiles', { count: truncatePreview?.fileChanges.length ?? 0 })}
                    </div>
                    <div className="max-h-32 overflow-y-auto rounded-md border border-border p-2">
                      {truncatePreview && truncatePreview.fileChanges.length > 0 ? (
                        truncatePreview.fileChanges.map((f) => (
                          <div key={`${f.absPath}-${f.timestamp}`} className="truncate py-0.5 text-xs text-muted-foreground">
                            <span className="mr-1 rounded bg-muted px-1 py-px text-[10px]">{f.operation}</span>
                            {f.absPath}
                          </div>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">{t('task.truncateNoFiles')}</span>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTruncateTarget(null);
                  setTruncatePreview(null);
                }}
                disabled={truncating}
              >
                {t('task.truncateCancel')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleTruncateConfirm}
                disabled={truncateLoading || truncating}
              >
                {truncating ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
                {t('task.truncateConfirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Task Input */}
        <div className="shrink-0 p-3">
          {/* 当前 skill 模式 Badge（点击 ✕ 发送 /skill:exit 退出） */}
          {activeSkill && (
            <div className="mb-2 flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300">
                <Sparkles className="size-3" />
                {t('task.skillModeActive', { name: activeSkill.name })}
              </span>
              <button
                type="button"
                title={t('task.skillModeExit')}
                aria-label={t('task.skillModeExit')}
                disabled={isGenerating}
                onClick={() => void handleSend('/skill:exit')}
                className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              >
                <X className="size-3" />
              </button>
            </div>
          )}
          {/* 通用中控岛：模块化控制容器（todo / 工具权限确认），默认折叠 */}
          <ControlHub
            status={
              isGenerating ? (
                <>
                  <Loader2 className="size-3.5 animate-spin text-primary" />
                  <span className="text-xs font-medium text-primary">{t('hub.statusRunning')}</span>
                </>
              ) : (
                <>
                  <Circle className="size-2.5 fill-current text-muted-foreground/50" />
                  <span className="text-xs font-medium text-muted-foreground">{t('hub.statusIdle')}</span>
                </>
              )
            }
            activeModuleId={hubActiveModule}
            onActiveModuleChange={(moduleId) => setHubActiveModule(taskId, moduleId)}
            modules={[
              {
                id: 'todo',
                icon: ListTodo,
                title: t('hub.todoModule'),
                badge: todos.filter((td) => td.status !== 'completed').length,
                render: () =>
                  todos.length === 0 ? (
                    <div className="flex items-center gap-1.5 px-1 py-2 text-xs text-muted-foreground">
                      <ListTodo className="size-3.5" />
                      {t('task.noTodos')}
                    </div>
                  ) : (
                    <TodoProgressCard todos={todos} variant="inline" />
                  ),
              },
              {
                id: 'permission',
                icon: ShieldCheck,
                title: t('hub.permissionModule'),
                badge:
                  pendingAsks.filter((a) => a.sessionId === taskId).length +
                  pendingConfirms.filter((c) => c.sessionId === taskId).length,
                render: () => {
                  const asks = pendingAsks.filter((a) => a.sessionId === taskId);
                  const confirms = pendingConfirms.filter((c) => c.sessionId === taskId);
                  if (asks.length === 0 && confirms.length === 0) {
                    return (
                      <div className="flex items-center gap-1.5 px-1 py-2 text-xs text-muted-foreground">
                        <ShieldCheck className="size-3.5" />
                        {t('hub.noPending')}
                      </div>
                    );
                  }
                  return (
                    <div className="flex flex-col gap-2">
                      {asks.map((ask) => (
                        <AskPromptCard key={ask.toolCallId} ask={ask} />
                      ))}
                      {confirms.map((cf) => (
                        <ConfirmPromptCard key={cf.toolCallId} confirm={cf} />
                      ))}
                    </div>
                  );
                },
              },
            ]}
          />
          <div className="mt-1.5">
            <TaskInput
              variant="task"
              isGenerating={isGenerating}
              onAbort={() => abort(taskId)}
              onOpenOverlay={onOpenOverlay}
              onSend={handleSend}
            />
          </div>
          {/* 运行指标栏（run 级口径，每次发送消息重置） */}
          <StatsBar stats={runStats} />
        </div>
      </div>

      {/* Right Panel — 移动端：Sheet 抽屉；桌面端：内嵌 aside */}
      {isMobile ? (
        <Sheet open={rightPanelOpen} onOpenChange={setRightPanelOpen}>
          <SheetContent
            side="right"
            showCloseButton={false}
            className="w-[85%] max-w-sm gap-0 bg-card p-0 text-card-foreground"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{t('task.taskSummary')}</SheetTitle>
              <SheetDescription>{t('task.taskSummary')}</SheetDescription>
            </SheetHeader>
            {rightPanelContent}
          </SheetContent>
        </Sheet>
      ) : (
        rightPanelOpen && (
          <aside
            className="relative flex flex-col border-l border-border bg-card"
            style={{ width: rightPanelWidth }}
          >
            <div
              {...rightResize.bind}
              className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none select-none after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:-translate-x-1/2 after:bg-transparent hover:after:bg-border"
            />
            {rightPanelContent}
          </aside>
        )
      )}
    </div>
  );
}

/** 右侧面板标签页（支持拖拽排序） */
interface SortableTabProps {
  tab: SidebarTab;
  isActive: boolean;
  canShowClose: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}
function SortableTab({ tab, isActive, canShowClose, onSelect, onRemove }: SortableTabProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  });
  // 追踪拖拽状态：拖拽结束后抑制紧随的 click 事件
  const wasDragRef = useRef(false);
  useEffect(() => {
    if (isDragging) {
      wasDragRef.current = true;
    } else if (wasDragRef.current) {
      const timer = setTimeout(() => { wasDragRef.current = false; });
      return () => clearTimeout(timer);
    }
  }, [isDragging]);
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (wasDragRef.current) {
          wasDragRef.current = false;
          return;
        }
        onSelect(tab.id);
      }}
      className={cn(
        'group relative flex cursor-grab items-center gap-1.5 rounded-lg border px-3 py-1 text-sm transition-colors',
        isDragging && 'z-10 border-border bg-muted text-foreground shadow-sm',
        isActive
          ? 'border-border bg-muted text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
      {tab.type === 'terminal' ? (
        <Terminal className="size-3.5" />
      ) : (
        <List className="size-3.5" />
      )}
      <span className="max-w-[120px] truncate">{t(tab.title)}</span>
      {/* hover 时显示 X 关闭按钮（单标签不显示） */}
      {canShowClose && !isDragging && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(tab.id);
          }}
          className="ml-0.5 hidden size-4 items-center justify-center rounded hover:bg-muted group-hover:flex"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

/** 渲染单条消息 */
interface MessageBubbleProps {
  message: TaskMessage;
  todos: TodoItem[];
  toolIconMap: Record<string, string>;
  /** 流式生成中禁用撤回（防竞态） */
  truncateDisabled?: boolean;
  onTruncate?: (message: TaskMessage) => void;
  onCopy?: (content: string) => void;
}
const MessageBubble = memo(function MessageBubble({ message, todos, toolIconMap, truncateDisabled, onTruncate, onCopy }: MessageBubbleProps) {
  const { t } = useTranslation();
  // 超长正文截断渲染（防止单条巨型文本布局卡死）；展开后完整渲染。
  // 流式生成中超限时显示尾部（正在生成的内容在末尾），结束后恢复头部截断。
  const [expanded, setExpanded] = useState(false);
  const overLimit = message.content.length > MAX_RENDER_CHARS;
  const displayContent = overLimit && !expanded
    ? message.streaming
      ? '…' + message.content.slice(-MAX_RENDER_CHARS)
      : message.content.slice(0, MAX_RENDER_CHARS) + '…'
    : message.content;

  // skill-mode greet：居中系统提示气泡
  if (message.role === 'system') {
    return (
      <div className="flex justify-center">
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
          <Sparkles className="size-3 shrink-0" />
          <span className="max-w-md truncate">{message.content}</span>
        </div>
      </div>
    );
  }
  // 防御：tool 已被适配层合并进 assistant；此处不应出现
  if (message.role === 'tool') return null;
  if (message.role === 'user') {
    return (
      <div className="group flex flex-col items-end gap-1">
        <div className="max-w-[80%] rounded-2xl border border-border bg-indigo-100 px-3 py-2 text-sm text-foreground shadow-sm break-words dark:bg-blue-600 dark:text-white dark:shadow-[0_2px_14px_rgba(37,99,235,0.35)]">
        {displayContent}
      </div>
      {overLimit && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="max-w-[80%] self-end rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t('task.messageTruncated')}
        >
          {expanded ? t('task.todoCollapse') : t('task.messageExpand')}
        </button>
      )}
        {/* 操作行：复制 + 撤回（hover 显示；触屏常显；生成中撤回禁用） */}
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
          <button
            type="button"
            title={t('task.messageCopy')}
            aria-label={t('task.messageCopy')}
            onClick={() => onCopy?.(message.content)}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            title={truncateDisabled ? t('task.truncateDisabled') : t('task.truncateMessage')}
            aria-label={t('task.truncateMessage')}
            disabled={truncateDisabled}
            onClick={() => onTruncate?.(message)}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Undo2 className="size-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // assistant 消息
  return (
    <div className="flex flex-col gap-2">
      {/* thinking 折叠区 */}
      {message.thinking && (
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
            {message.thinkingStreaming ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Atom className="size-3.5" />
            )}
            <span>{message.thinkingStreaming ? t('task.thinkingStreaming') : t('task.thinkingDone')}</span>
          </summary>
          <div className="mt-1 text-xs text-muted-foreground">
            {message.thinking}
          </div>
        </details>
      )}
      {/* 正文 */}
      {message.content && !message.isError && (
        <div className="whitespace-pre-wrap break-words text-sm text-foreground">
          {displayContent}
          {message.streaming && (
            <Loader2 className="ml-1 inline size-3 animate-spin" />
          )}
        </div>
      )}
      {overLimit && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t('task.messageTruncated')}
        >
          {expanded ? t('task.todoCollapse') : t('task.messageExpand')}
        </button>
      )}
      {/* todo 工具调用 → 在任务流中渲染 TodoProgressCard（像其他工具一样在调用位置显示）。
          渲染条件基于消息自身快照（?? 回落到 store）：store 被清空不牵连历史卡片。 */}
      {message.toolCalls?.some((tc) => tc.name === 'todo') && (message.todoSnapshot ?? todos).length > 0 && (
        <TodoProgressCard todos={message.todoSnapshot ?? todos} variant="inline" />
      )}
      {/* ask 工具调用 → 渲染为问答卡片（仅已完成、有结果时渲染；进行中的由底部 AskPromptCard 处理） */}
      {message.toolCalls?.filter((tc) => tc.name === 'ask').map((tc) => {
        const matchedResult = message.toolResults?.find((tr) => tr.toolCallId === tc.id);
        if (!matchedResult) return null; // 只渲染已完成的 ask
        const fullText = matchedResult.result.content
          .filter((c) => c.type === 'text')
          .map((c) => (c.type === 'text' ? c.text : ''))
          .join('\n');
        // 工具返回固定格式「问题：X\n用户回答：Y」；问题优先取 arguments，回答取"用户回答："之后的部分
        let replyText = fullText;
        const answerMarker = fullText.indexOf('用户回答：');
        if (answerMarker !== -1) {
          replyText = fullText.slice(answerMarker + '用户回答：'.length);
        }
        let questionText = '';
        try {
          questionText = (JSON.parse(tc.arguments || '{}') as { question?: string }).question ?? '';
        } catch {
          questionText = '';
        }
        return (
          <div
            key={tc.id}
            className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3 shadow-sm"
          >
            <div className="flex items-center gap-1.5">
              <HelpCircle className="size-3.5 text-primary" />
              <span className="text-xs font-medium text-foreground">{t('task.askTitle')}</span>
            </div>
            <div>
              <div className="text-xs text-muted-foreground/70">{t('task.askQuestion')}</div>
              <p className="whitespace-pre-wrap text-sm text-foreground">{questionText}</p>
            </div>
            {replyText && (
              <div>
                <div className="text-xs text-muted-foreground/70">{t('task.askReply')}</div>
                <p className="whitespace-pre-wrap text-sm text-foreground">{replyText}</p>
              </div>
            )}
          </div>
        );
      })}
      {/* 非 todo/ask 工具调用（可折叠：展开显示参数与结果） */}
      {message.toolCalls && message.toolCalls.filter((tc) => tc.name !== 'todo' && tc.name !== 'ask').length > 0 && (
        <div className="flex flex-col gap-1">
          {message.toolCalls.filter((tc) => tc.name !== 'todo' && tc.name !== 'ask').map((tc) => {
            const matchedResult = message.toolResults?.find((tr) => tr.toolCallId === tc.id);
            const resultText = matchedResult?.result.content
              .filter((c) => c.type === 'text')
              .map((c) => (c.type === 'text' ? c.text : ''))
              .join('\n');
            const isError = matchedResult?.result.isError;
            // MCP 扩展：structuredContent（结构化输出）/ resources（资源引用）
            const structured = matchedResult?.result.metadata?.structuredContent;
            const resources = matchedResult?.result.metadata?.resources;
            let prettyArgs = tc.arguments;
            try {
              prettyArgs = JSON.stringify(JSON.parse(tc.arguments || '{}'), null, 2);
            } catch {
              // 非 JSON，原样显示
            }
            return (
              <details key={tc.id} className="group px-2 py-1">
                <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
                  {tc.status === 'generating' || tc.status === 'executing' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    (() => {
                      const ToolIcon = resolveToolIcon(tc.name, toolIconMap);
                      return <ToolIcon className="size-3.5" />;
                    })()
                  )}
                  <span>{tc.name}</span>
                  {tc.status === 'generating' && (
                    <span className="text-muted-foreground/60">{t('terminal.generating')}</span>
                  )}
                  {tc.status === 'executing' && (
                    <span className="text-muted-foreground/60">{t('terminal.executing')}</span>
                  )}
                </summary>
                <div className="mt-1 flex flex-col gap-2 rounded-md border border-border p-2 text-xs max-h-[300px] overflow-auto no-scrollbar">
                  {tc.arguments && (
                    <div>
                      <div className="text-muted-foreground/70">{t('task.toolCallArguments')}</div>
                      <pre className="mono mt-0.5 whitespace-pre-wrap break-all text-foreground">
                        {prettyArgs}
                      </pre>
                    </div>
                  )}
                  {resultText && (
                    <div>
                      <div className={cn('text-muted-foreground/70', isError && 'text-destructive/80')}>
                        {isError ? t('task.errorResult') : t('task.result')}
                      </div>
                      <pre className={cn(
                        'mono mt-0.5 whitespace-pre-wrap break-all',
                        isError ? 'text-destructive' : 'text-foreground',
                      )}>
                        {resultText}
                      </pre>
                    </div>
                  )}
                  {/* MCP structuredContent：结构化输出 JSON */}
                  {structured && (
                    <div>
                      <div className="text-muted-foreground/70">{t('task.structuredOutput')}</div>
                      <pre className="mono mt-0.5 whitespace-pre-wrap break-all text-foreground">
                        {JSON.stringify(structured, null, 2)}
                      </pre>
                    </div>
                  )}
                  {/* MCP resources：资源引用卡片（uri + mimeType + 可展开 text） */}
                  {resources && resources.length > 0 && (
                    <div>
                      <div className="text-muted-foreground/70">{t('task.resourceRefs', { count: resources.length })}</div>
                      <div className="mt-0.5 flex flex-col gap-1">
                        {resources.map((r) => (
                          <details key={r.uri} className="group/res rounded border border-border px-1.5 py-1">
                            <summary className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                              <ChevronRight className="size-3 transition-transform group-open/res:rotate-90" />
                              <FileText className="size-3 shrink-0" />
                              <span className="truncate">{r.uri}</span>
                              {r.mimeType && (
                                <span className="ml-auto shrink-0 rounded bg-muted px-1 py-px text-[10px]">{r.mimeType}</span>
                              )}
                            </summary>
                            {r.text && (
                              <pre className="mono mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-foreground">
                                {r.text}
                              </pre>
                            )}
                          </details>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}
      {/* 错误消息 */}
      {message.isError && (
        <Card className="border-destructive/50 p-2 text-xs text-destructive">
          {message.content}
        </Card>
      )}
    </div>
  );
});
