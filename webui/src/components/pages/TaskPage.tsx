import { useState, useEffect, useCallback, memo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
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
import { useStore } from '../../store';
import { useTask } from '../../hooks/useTask';
import { api } from '../../api/http';
import { wsClient } from '../../api/ws';
import type { TaskMessage, TodoItem, SidebarTab } from '../../types/api';

// 稳定引用的空数组，避免 useStore 选择器每次返回新 [] 触发 useSyncExternalStore 无限循环
const EMPTY_MESSAGES: TaskMessage[] = [];
const EMPTY_TODOS: TodoItem[] = [];

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

  // 挂载时加载会话历史（若 store 中无消息）+ todos + context
  useEffect(() => {
    if (!taskId) return; // 空 taskId 守卫：避免污染 store 的 activeSessionId/activeTaskId
    if (messages.length === 0) {
      void api
        .getSessionHistory(taskId)
        .then((resp) => {
          if (resp.messages && resp.messages.length > 0) {
            useStore.getState().setMessages(taskId, resp.messages);
          }
        })
        .catch(() => {
          // 后端未就绪或会话不存在，静默
        });
    }
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
        <div className="min-h-0 flex-1 overflow-y-auto task-scroll-area">
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
              <MessageBubble key={msg.id} message={msg} todos={todos} toolIconMap={toolIconMap} />
            ))}
            {isGenerating && messages[messages.length - 1]?.role !== 'assistant' && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span className="text-sm">{t('task.thinking')}</span>
              </div>
            )}
            {pendingAsks.filter((a) => a.sessionId === taskId).map((ask) => (
              <AskPromptCard key={ask.toolCallId} ask={ask} />
            ))}
            {pendingConfirms.filter((c) => c.sessionId === taskId).map((cf) => (
              <ConfirmPromptCard key={cf.toolCallId} confirm={cf} />
            ))}
          </div>
        </div>

        {/* Task Input */}
        <div className="shrink-0 p-3">
          <TaskInput
            variant="task"
            isGenerating={isGenerating}
            onAbort={() => abort(taskId)}
            onOpenOverlay={onOpenOverlay}
            onSend={handleSend}
          />
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
}
const MessageBubble = memo(function MessageBubble({ message, todos, toolIconMap }: MessageBubbleProps) {
  const { t } = useTranslation();

  // 防御：system 已被后端物理隔离、tool 已被适配层合并进 assistant；此处不应出现
  if (message.role === 'system' || message.role === 'tool') return null;
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl border border-border bg-indigo-100 px-3 py-2 text-sm text-foreground shadow-sm dark:bg-blue-600 dark:text-white dark:shadow-[0_2px_14px_rgba(37,99,235,0.35)]">
          {message.content}
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
        <div className="whitespace-pre-wrap text-sm text-foreground">
          {message.content}
          {message.streaming && (
            <Loader2 className="ml-1 inline size-3 animate-spin" />
          )}
        </div>
      )}
      {/* todo 工具调用 → 在任务流中渲染 TodoProgressCard（像其他工具一样在调用位置显示） */}
      {message.toolCalls?.some((tc) => tc.name === 'todo') && todos.length > 0 && (
        <TodoProgressCard todos={message.todoSnapshot ?? todos} variant="inline" />
      )}
      {/* ask 工具调用 → 渲染为问答卡片（仅已完成、有结果时渲染；进行中的由底部 AskPromptCard 处理） */}
      {message.toolCalls?.filter((tc) => tc.name === 'ask').map((tc) => {
        const matchedResult = message.toolResults?.find((tr) => tr.toolCallId === tc.id);
        if (!matchedResult) return null; // 只渲染已完成的 ask
        const replyText = matchedResult.result.content
          .filter((c) => c.type === 'text')
          .map((c) => (c.type === 'text' ? c.text : ''))
          .join('\n');
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
