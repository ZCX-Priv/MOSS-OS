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
  CircleAlert,
  Package,
  Zap,
  Paperclip,
  Inbox,
} from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { resolveToolIcon } from '@/lib/tool-icons';
import { MarkdownRenderer } from '../../render';
import type { OverlayType } from '../../types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
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
import { ScrollToBottomButton } from '../shared/ScrollToBottomButton';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { TodoProgressCard, TodoRow } from '../shared/TodoProgressCard';
import { AskPromptCard } from '../shared/AskPromptCard';
import { ConfirmPromptCard } from '../shared/ConfirmPromptCard';
import { TerminalView } from '../shared/TerminalView';
import { ControlHub } from '../shared/ControlHub';
import { StatsBar } from '../shared/StatsBar';
import { CompactionCard } from '../shared/CompactionCard';
import { MaxTurnsNoticeCard } from '../shared/MaxTurnsNoticeCard';
import { useStore } from '../../store';
import { useTask } from '../../hooks/useTask';
import { api } from '../../api/http';
import { wsClient } from '../../api/ws';
import type { TaskMessage, TodoItem, SidebarTab, CompactPreview, ContextStats } from '../../types/api';

// 稳定引用的空数组，避免 useStore 选择器每次返回新 [] 触发 useSyncExternalStore 无限循环
const EMPTY_MESSAGES: TaskMessage[] = [];
const EMPTY_TODOS: TodoItem[] = [];
const EMPTY_QUEUE: Array<{ id: string; content: string; timestamp: string }> = [];

// 单条消息正文渲染上限：超长内容（如 base64/大文件摘录）截断渲染，防止一次性布局卡死滚动
const MAX_RENDER_CHARS = 6000;

// 用户消息尾部附件块（TaskInput 发送时生成）：空行 + 标签行（以：/: 结尾）+ 连续"- 绝对路径"行。
// 标签行文本随 i18n 变化故按结构匹配；路径特征校验（Windows 盘符 / Unix 根）避免误伤普通列表。
const ATTACHMENT_BLOCK_RE =
  /\n\n[^\n]+[:：]\n((?:- (?:[A-Za-z]:[\\/][^\n]+|\/[^\n]+)\n?)+)$/;

function parseAttachmentBlock(content: string): { body: string; paths: string[] } | null {
  const m = ATTACHMENT_BLOCK_RE.exec(content);
  if (!m) return null;
  const paths = m[1]
    .split('\n')
    .map((l) => l.replace(/^- /, '').trim())
    .filter(Boolean);
  if (paths.length === 0) return null;
  return { body: content.slice(0, m.index), paths };
}

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
  onOpenOverlay?: (overlay: OverlayType) => void;
}

export function TaskPage({ onOpenOverlay }: TaskPageProps) {
  const { t } = useTranslation();
  const { taskId = '' } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  // 右侧面板展开态（会话级）/宽度（全局）：store 内存态而非本地 state，TaskPage 因路由
  // 切换重挂载时保持不重置；开合按会话独立（一个会话收起不影响其他会话），宽度作为
  // UI 偏好跨会话共享；taskId 为空串（空白页）时读写 '' key，建会话时随对话转移
  const rightPanelOpen = useStore((s) => s.rightPanelOpenBySession[taskId] ?? false);
  const setRightPanelOpen = useStore((s) => s.setRightPanelOpen);
  const rightPanelWidth = useStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useStore((s) => s.setRightPanelWidth);
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
  const messageQueue = useStore((s) => s.messageQueueBySession[taskId] ?? EMPTY_QUEUE);
  const removeFromMessageQueue = useStore((s) => s.removeFromMessageQueue);
  // 当前会话 run 统计（中控岛下方指标栏）与中控岛展开模块
  const runStats = useStore((s) => s.runStatsBySession[taskId]);
  const hubActiveModule = useStore((s) => s.hubActiveModuleBySession[taskId]);
  const setHubActiveModule = useStore((s) => s.setHubActiveModule);

  // ===== 中控岛自动展开/折叠 =====
  // 竞态防护：用户手动操作（chips/折叠按钮）经 handleHubModuleChange 记录时间戳并取消
  // 自动折叠定时器；程序化 setHubActiveModule 不经过包装，不会误标为用户操作
  const prevAskCountRef = useRef(0);
  const prevConfirmCountRef = useRef(0);
  /** todo 签名（id:status 列表）；null = 未初始化（首次跳过，防挂载误触发） */
  const prevTodoSigRef = useRef<string | null>(null);
  /** 上一次 todo 是否处于「全部完成」态（进入沿检测基准） */
  const prevAllDoneRef = useRef(false);
  /** 本次生成（run）内是否已执行过 todo「首次展开」；isGenerating 上升沿重置 */
  const runTodoExpandedRef = useRef(false);
  /** 上一次 isGenerating（上升沿检测基准） */
  const prevGeneratingRef = useRef(false);
  /** 上一次处理的会话 id（切换会话时重置基准，防跨会话比较误触发） */
  const lastHubTaskIdRef = useRef('');
  /** todo 自动折叠定时器（变更后展示 3s） */
  const todoCollapseTimerRef = useRef<number | null>(null);
  /** 用户最近一次手动操作时间（自动折叠前校验，防止与用户操作打架） */
  const lastUserActionAtRef = useRef(0);
  /** 最近一次自动展开时间 */
  const autoExpandAtRef = useRef(0);

  const clearTodoCollapseTimer = useCallback(() => {
    if (todoCollapseTimerRef.current !== null) {
      window.clearTimeout(todoCollapseTimerRef.current);
      todoCollapseTimerRef.current = null;
    }
  }, []);

  /** 用户手动切换模块（chips 点击/折叠按钮）：标记操作时间并取消待执行的自动折叠 */
  const handleHubModuleChange = useCallback(
    (moduleId: string | null) => {
      lastUserActionAtRef.current = Date.now();
      clearTodoCollapseTimer();
      setHubActiveModule(taskId, moduleId);
    },
    [clearTodoCollapseTimer, setHubActiveModule, taskId],
  );

  // 自动行为：新提问/权限确认到达 → 自动展开并切换对应类别；回答/处理后 → 默认折叠；
  // todo 变更 → 仅两个时机展开（各展示 3s 后自动折叠，不抢占待处理的提问/权限）：
  //   ① 本次生成内首次建立/变更（发送任务后 todo 首次出现/变化）
  //   ② 进入「全部完成」态（所有项 completed 的上升沿）
  //   中间变更不展开、不重置定时器（面板内容仍随 store 实时刷新）
  useEffect(() => {
    if (!taskId) return;
    // 会话切换：重置基准状态（在比较前执行，避免旧会话计数/签名误触发）
    if (lastHubTaskIdRef.current !== taskId) {
      lastHubTaskIdRef.current = taskId;
      prevAskCountRef.current = 0;
      prevConfirmCountRef.current = 0;
      prevTodoSigRef.current = null;
      prevAllDoneRef.current = false;
      runTodoExpandedRef.current = false;
      clearTodoCollapseTimer();
    }
    // 生成开始（上升沿）：重置「run 内首次展开」标志，下一次 todo 变更即为本次生成的首次
    if (isGenerating && !prevGeneratingRef.current) {
      runTodoExpandedRef.current = false;
    }
    prevGeneratingRef.current = isGenerating;
    const askCount = pendingAsks.filter((a) => a.sessionId === taskId).length;
    const confirmCount = pendingConfirms.filter((c) => c.sessionId === taskId).length;
    const todoSig = todos.map((td) => `${td.id}:${td.status}`).join('|');
    const prevAsk = prevAskCountRef.current;
    const prevConfirm = prevConfirmCountRef.current;
    const prevTodoSig = prevTodoSigRef.current;
    const prevAllDone = prevAllDoneRef.current;
    const wasRunTodoExpanded = runTodoExpandedRef.current;
    const nowAllDone = todos.length > 0 && todos.every((td) => td.status === 'completed');
    const todoChanged = prevTodoSig !== null && todoSig !== prevTodoSig;
    prevAskCountRef.current = askCount;
    prevConfirmCountRef.current = confirmCount;
    prevTodoSigRef.current = todoSig;
    // 基准在分支前无条件推进（ask/confirm 分支提前 return 也不能让基准过期）；
    // 分支内使用的是上方捕获的旧值 wasRunTodoExpanded / prevAllDone
    prevAllDoneRef.current = nowAllDone;
    runTodoExpandedRef.current = wasRunTodoExpanded || todoChanged;

    // 新提问到达：切换/展开 ask（阻塞 agent，最高优先级）
    if (askCount > prevAsk) {
      clearTodoCollapseTimer();
      setHubActiveModule(taskId, 'ask');
      autoExpandAtRef.current = Date.now();
      return;
    }
    // 提问清空（已回答）：默认折叠；仍有待确认权限则切过去
    if (prevAsk > 0 && askCount === 0 && hubActiveModule === 'ask') {
      setHubActiveModule(taskId, confirmCount > 0 ? 'permission' : null);
      return;
    }
    // 新权限确认到达：切换/展开 permission
    if (confirmCount > prevConfirm) {
      clearTodoCollapseTimer();
      setHubActiveModule(taskId, 'permission');
      autoExpandAtRef.current = Date.now();
      return;
    }
    // 权限确认清空（已处理）：默认折叠；仍有待答提问则切回去
    if (prevConfirm > 0 && confirmCount === 0 && hubActiveModule === 'permission') {
      setHubActiveModule(taskId, askCount > 0 ? 'ask' : null);
      return;
    }
    // todo 变更（跳过首次初始化）：无阻塞项时，仅「本次生成内首次变更」或
    // 「进入全部完成态」两个时机展开 3s 后自动折叠；中间变更静默刷新不展开
    if (todoChanged && askCount === 0 && confirmCount === 0) {
      const isFirstChange = !wasRunTodoExpanded;
      const becomesAllDone = nowAllDone && !prevAllDone;
      if (isFirstChange || becomesAllDone) {
        clearTodoCollapseTimer();
        setHubActiveModule(taskId, 'todo');
        autoExpandAtRef.current = Date.now();
        todoCollapseTimerRef.current = window.setTimeout(() => {
          todoCollapseTimerRef.current = null;
          const s = useStore.getState();
          // 竞态防护：仅当仍处于 todo 模块且自动展开后用户无手动干预时才折叠
          if (
            s.hubActiveModuleBySession[taskId] === 'todo' &&
            lastUserActionAtRef.current <= autoExpandAtRef.current
          ) {
            s.setHubActiveModule(taskId, null);
          }
        }, 3000);
      }
    }
  }, [
    pendingAsks,
    pendingConfirms,
    todos,
    hubActiveModule,
    taskId,
    isGenerating,
    setHubActiveModule,
    clearTodoCollapseTimer,
  ]);

  // ===== 消息撤回（截断）状态机 =====
  /** 待确认的撤回目标（用户消息） */
  const [truncateTarget, setTruncateTarget] = useState<TaskMessage | null>(null);
  // ===== 滚动控制 =====
  /** 滚动容器 ref（.task-scroll-area）；跟随状态机见 useAutoScroll */
  const scrollRef = useRef<HTMLDivElement>(null);
  /** 预览加载中 */
  const [truncateLoading, setTruncateLoading] = useState(false);
  /** 预览结果 */
  const [truncatePreview, setTruncatePreview] = useState<{
    messagesToRemove: Array<{ index: number; role: string; content: string }>;
    fileChanges: Array<{ absPath: string; operation: string; toolName: string; timestamp: string }>;
    rollbackSkippedReason?: 'no-file-history' | 'no-timestamp';
  } | null>(null);
  /** 执行中 */
  const [truncating, setTruncating] = useState(false);
  const context = useStore((s) => s.contextBySession[taskId]);
  /** 上下文引擎统计（token 构成/缓存命中/压缩状态/系统分段；stats API + WS 事件维护） */
  const contextStats = useStore((s) => s.contextStatsBySession[taskId]);

  // ===== 手动压缩状态机（空闲可用 + 确认对话框） =====
  const [compactDialogOpen, setCompactDialogOpen] = useState(false);
  const [compactPreview, setCompactPreview] = useState<CompactPreview | null>(null);
  const [compactPreviewLoading, setCompactPreviewLoading] = useState(false);
  const [compacting, setCompacting] = useState(false);

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
    // 滚动状态重置由 useAutoScroll 的 resetKey(taskId) 驱动
    void api
      .getSessionHistory(taskId)
      .then((resp) => {
        if (resp.messages && resp.messages.length > 0) {
          if (!useStore.getState().generatingBySession[taskId]) {
            useStore.getState().setMessages(taskId, resp.messages);
          }
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
    // 加载上下文引擎统计（token 构成/缓存命中/系统分段；右侧面板 + 后续 WS 增量更新）
    void api
      .getContextStats(taskId)
      .then((stats) => {
        useStore.getState().setContextStats(taskId, stats);
      })
      .catch(() => {
        // 后端无 context 引擎或会话不存在：静默（Context Section 降级为文件列表）
      });
    // 加载压缩历史并恢复压缩卡片（刷新后消息流中的压缩卡片重现）
    void api
      .getCompactions(taskId)
      .then(({ compactions }) => {
        if (!Array.isArray(compactions) || compactions.length === 0) return;
        const s = useStore.getState();
        const existing = s.messagesBySession[taskId] ?? [];
        const existingIds = new Set(existing.map((m) => m.id));
        const cards: TaskMessage[] = compactions
          .filter((c) => !existingIds.has(`compaction_${c.id}`))
          .map((c) => ({
            id: `compaction_${c.id}`,
            role: 'assistant' as const,
            content: c.summary,
            timestamp: c.at,
            compaction: c,
          }));
        if (cards.length > 0) {
          // 按 timestamp 排序合并（卡片插入消息流的时间序列位置）
          const merged = [...existing, ...cards].sort(
            (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
          );
          s.setMessages(taskId, merged);
        }
      })
      .catch(() => {});
    // 设置当前活跃 session
    useStore.getState().setActiveSession(taskId);
    useStore.getState().setActiveTaskId(taskId);
    // 同步后端 ConnectionState，确保异步事件推送到正确连接
    // （subscribeSession 会记住订阅关系：WS 断线重连后自动重订阅，防止事件丢失）
    wsClient.subscribeSession(taskId);

    return () => {
      // 卸载时若 activeSessionId 仍指向自己，清除之，防止 useWebSocket 误用旧 session。
      // 注意：不停止后端 agent.run（任务可在后台继续），仅防状态污染。
      clearTodoCollapseTimer(); // 清理待执行的 todo 自动折叠定时器
      const cur = useStore.getState().activeSessionId;
      if (cur === taskId) {
        useStore.getState().setActiveSession(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // ===== 自动滚动（状态机 hook）=====
  // 发送后仅跟随态自动滚底（看历史时不拉回）；流式期间用户上滑（wheel/触摸/拖滚动条）
  // 即时脱离跟随、绝不被拉回；滚回底部附近自动恢复跟随；切会话由 resetKey 重置并强滚底。
  const lastMessage = messages[messages.length - 1];
  const lastContentLength = lastMessage?.content.length ?? 0;
  const { atBottom, isPinned, scrollToBottom } = useAutoScroll(scrollRef, {
    resetKey: taskId,
    scrollDeps: [messages.length, lastContentLength, isGenerating],
  });

  const contextFiles = context?.files ?? [];
  const totalTokens = context?.totalTokens ?? 0;
  const maxTokens = context?.maxTokens ?? 1;
  const contextPercent = maxTokens > 0 ? Math.round((totalTokens / maxTokens) * 100) : 0;

  // ===== 右侧面板 Tab 切换状态机 =====
  // 默认"系统"；仅当 LLM 真实读取文件（WS context-updated，read/grep/glob）时自动切到"文件"；
  // 用户手动切换后不再自动切换（尊重用户操作）；切换会话时重置回"系统"。
  const [contextTab, setContextTab] = useState('system');
  const contextTabUserTouchedRef = useRef(false);
  const prevTaskIdRef = useRef(taskId);
  const contextFileReadSeq = useStore((s) => s.contextFileReadSeqBySession[taskId]);
  // LLM 新读取文件（seq 递增）且用户未手动切换过 → 自动切到"文件"
  useEffect(() => {
    if (contextFileReadSeq == null || contextFileReadSeq < 1) return;
    if (contextTabUserTouchedRef.current) return;
    setContextTab('files');
  }, [contextFileReadSeq]);
  // 会话切换：重置为默认"系统"，恢复自动切换能力
  useEffect(() => {
    if (prevTaskIdRef.current === taskId) return;
    prevTaskIdRef.current = taskId;
    contextTabUserTouchedRef.current = false;
    setContextTab('system');
  }, [taskId]);
  // 受控值防御：contextTab 指向的条件 tab（summary）消失时回退"系统"
  const contextTabValue =
    (contextTab === 'summary' && !contextStats?.breakdown?.summary)
      ? 'system'
      : contextTab;

  // 空状态：发送消息后创建任务并跳转；任务态：直接发送到当前 session
  const handleSend = useCallback(
    async (text: string) => {
      // 仅跟随态才自动滚底：用户上滑看历史时发送消息，视图停留在原位不被拉回底部；
      // 已脱离跟随时 scrollDeps effect 同样不滚底（pinnedRef=false），后续消息追加自然不打扰
      if (isPinned()) scrollToBottom('auto');
      if (taskId) {
        sendMessage(text, { taskId });
      } else {
        const newTaskId = await sendMessage(text);
        if (newTaskId) {
          // 空白页创建新会话：面板开合状态随对话转移到新会话，避免 navigate 重挂载后收起
          useStore.getState().migrateRightPanelState('', newTaskId);
          navigate(`/task/${newTaskId}`);
        }
      }
    },
    [taskId, sendMessage, navigate, isPinned, scrollToBottom],
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
        setTruncatePreview({
          messagesToRemove: resp.messagesToRemove,
          fileChanges: resp.fileChanges,
          ...(resp.rollbackSkippedReason ? { rollbackSkippedReason: resp.rollbackSkippedReason } : {}),
        });
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
              const restoreResp = await api.restoreTruncate(taskId);
              // 防御性刷新：WS 断线重连期间 session-restored 事件可能丢失，
              // 恢复成功后直接拉取历史刷新 UI（WS 正常时两者幂等一致）
              if (restoreResp.restoredCount > 0) {
                useStore.getState().setTruncateBackup(taskId, undefined);
                const hist = await api.getSessionHistory(taskId);
                if (hist.messages && hist.messages.length > 0 && !useStore.getState().generatingBySession[taskId]) {
                  useStore.getState().setMessages(taskId, hist.messages);
                }
              }
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

  // ===== 手动压缩流程 =====
  /** 点击压缩按钮：拉取预览并弹确认框（运行中禁用由按钮 disabled 保证） */
  const handleCompactClick = useCallback(async () => {
    if (!taskId || isGenerating) return;
    setCompactDialogOpen(true);
    setCompactPreview(null);
    setCompactPreviewLoading(true);
    try {
      const preview = await api.compactPreview(taskId);
      setCompactPreview(preview);
    } catch {
      // 预览失败（无引擎/会话空）：弹框仍显示，提示不可压缩
      setCompactPreview(null);
    } finally {
      setCompactPreviewLoading(false);
    }
  }, [taskId, isGenerating]);

  /** 确认压缩：执行手动压缩，完成后 toast（卡片由 WS compaction-completed 插入消息流） */
  const handleCompactConfirm = useCallback(async () => {
    if (!taskId || compacting) return;
    setCompacting(true);
    try {
      const result = await api.manualCompact(taskId);
      if (result.ok && result.compaction) {
        // WS 不可达时兜底插入卡片 + 更新 stats
        const s = useStore.getState();
        const existing = s.messagesBySession[taskId] ?? [];
        if (!existing.some((m) => m.id === `compaction_${result.compaction!.id}`)) {
          s.setMessages(taskId, [
            ...existing,
            {
              id: `compaction_${result.compaction.id}`,
              role: 'assistant',
              content: result.compaction.summary,
              timestamp: result.compaction.at,
              compaction: result.compaction,
            },
          ]);
        }
        void api.getContextStats(taskId).then((stats) => useStore.getState().setContextStats(taskId, stats)).catch(() => {});
        setCompactDialogOpen(false);
      } else {
        toast.error(result.error ?? t('context.compactFailed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('context.compactFailed'));
    } finally {
      setCompacting(false);
    }
  }, [taskId, compacting, t]);

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
          <DropdownMenuContent align="start" sideOffset={4} collisionPadding={8}>
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
            {/* Context Section（上下文引擎：token 构成/缓存命中/动态分类/手动压缩） */}
            <div className="flex flex-1 flex-col gap-2 overflow-hidden p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <span>{t('task.context')}</span>
                  <Info className="size-3 text-muted-foreground" />
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={isGenerating || compacting || !taskId}
                  title={isGenerating ? t('context.compressDisabledRunning') : t('context.compressHint')}
                  onClick={handleCompactClick}
                >
                  {compacting ? <Loader2 className="size-3.5 animate-spin" /> : <Package className="size-3.5" />}
                  {t('task.compress')}
                </Button>
              </div>

              {/* token 构成堆叠条 + 百分比 + 缓存命中率徽章 */}
              <div className="flex items-center gap-2">
                {contextStats ? (
                  <ContextStackedBar stats={contextStats} />
                ) : (
                  <>
                    <Progress value={contextPercent} className="flex-1" />
                    <span className="text-xs text-muted-foreground">{contextPercent}%</span>
                  </>
                )}
                {contextStats?.avgHitRate != null && (
                  <span
                    className="flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] tabular-nums"
                    title={t('context.cacheHitHint')}
                    style={{
                      color: contextStats.avgHitRate >= 0.6 ? '#10b981' : contextStats.avgHitRate >= 0.3 ? '#f59e0b' : '#ef4444',
                      borderColor: contextStats.avgHitRate >= 0.6 ? '#10b98155' : contextStats.avgHitRate >= 0.3 ? '#f59e0b55' : '#ef444455',
                    }}
                  >
                    <Zap className="size-2.5" />
                    {Math.round(contextStats.avgHitRate * 100)}%
                  </span>
                )}
              </div>

              {/* 动态标签：默认 系统；LLM 读取文件后自动切到 文件；有活跃技能/压缩摘要时动态追加 */}
              <Tabs
                value={contextTabValue}
                onValueChange={(v) => {
                  contextTabUserTouchedRef.current = true;
                  setContextTab(v);
                }}
                className="flex flex-1 flex-col gap-2 overflow-hidden"
              >
                <TabsList>
                  <TabsTrigger value="system">{t('context.tabSystem')}</TabsTrigger>
                  <TabsTrigger value="files">{t('task.files')}</TabsTrigger>
                  {contextStats?.breakdown?.summary ? (
                    <TabsTrigger value="summary">{t('context.tabSummary')}</TabsTrigger>
                  ) : null}
                </TabsList>

                {/* 系统标签页：折叠栏展示系统上下文各段（身份/规则/规范引导/环境/工具定义/技能） */}
                <TabsContent value="system" className="flex-1 min-h-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="flex flex-col gap-1 pr-1">
                      {contextStats?.systemSections?.length ? (
                        contextStats.systemSections.map((section) => (
                          <SystemSectionItem key={section.id} section={section} />
                        ))
                      ) : (
                        <span className="px-2 py-4 text-xs text-muted-foreground">
                          {t('context.noSystemSections')}
                        </span>
                      )}
                      {/* 压缩摘要折叠栏（系统页常驻入口） */}
                      {contextStats?.compaction?.lastCompaction && (
                        <SystemSectionItem
                          section={{
                            id: 'last-compaction',
                            title: t('context.lastCompaction'),
                            tokens: contextStats.compaction?.activeSummaryTokens ?? 0,
                            content: contextStats.compaction?.lastCompaction?.summary ?? '',
                            defaultOpen: false,
                          }}
                        />
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* 文件标签页：上下文文件轨迹 */}
                <TabsContent value="files" className="flex-1 min-h-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="flex flex-col gap-0.5">
                      {contextFiles.length === 0 ? (
                        <span className="px-2 py-4 text-xs text-muted-foreground">
                          {t('task.noContextFiles')}
                        </span>
                      ) : (
                        contextFiles.map((file) => {
                          // 文件已被删除（事件 reason）或磁盘上不存在（后端存在性校验 missing）→ 灰色 + 删除线
                          const removed = file.reason === 'delete' || file.missing === true;
                          return (
                            <Button
                              key={file.path}
                              variant="ghost"
                              size="xs"
                              className={cn('justify-start gap-1.5 font-normal', removed && 'opacity-60')}
                              title={removed ? t('task.fileRemovedFromContext') : undefined}
                            >
                              <FileText className={cn('size-3.5', removed ? 'text-muted-foreground' : 'text-primary-strong')} />
                              <span className={cn('truncate', removed && 'text-muted-foreground line-through')}>
                                {file.path}
                              </span>
                            </Button>
                          );
                        })
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* 摘要标签页：活跃压缩摘要全文 */}
                {contextStats?.breakdown?.summary ? (
                  <TabsContent value="summary" className="flex-1 min-h-0 overflow-hidden">
                    <ScrollArea className="h-full">
                      <div className="whitespace-pre-wrap break-words px-1 py-2 text-xs leading-relaxed text-foreground">
                        {contextStats.compaction?.lastCompaction?.summary ??
                          t('context.noSummary')}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                ) : null}
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
            onClick={() => setRightPanelOpen(taskId, !rightPanelOpen)}
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
            onClick={() => setRightPanelOpen(taskId, !rightPanelOpen)}
            title={rightPanelOpen ? t('task.collapseRightPanel') : t('task.expandRightPanel')}
          >
            <PanelRight />
          </Button>
        </div>

        {/* Task Messages（relative wrapper：返回底部按钮悬浮于滚动区上方、不随内容滚动） */}
        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} className="h-full overflow-y-auto task-scroll-area">
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
                <div className="message-cv anim-msg animate-in fade-in slide-in-from-bottom-2 duration-200" key={msg.id}>
                  <MessageBubble
                    message={msg}
                    todos={todos}
                    toolIconMap={toolIconMap}
                    truncateDisabled={isGenerating}
                    onTruncate={handleTruncateClick}
                    onCopy={handleCopyMessage}
                    onContinue={() => void handleSend(t('task.maxTurnsContinue'))}
                    continueDisabled={isGenerating}
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
          {/* 返回底部按钮：不在底部时显示；流式生成中显示顺时针跑马灯；点击滚底并恢复跟随 */}
          <ScrollToBottomButton
            visible={!atBottom}
            streaming={isGenerating}
            onClick={() => scrollToBottom('smooth')}
          />
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
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle>{t('task.truncateTitle')}</DialogTitle>
              <DialogDescription>
                {t('task.truncateDescription')}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="text-sm">
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
                    <div className="no-scrollbar max-h-32 overflow-auto rounded-md border border-border p-2">
                      {truncatePreview && truncatePreview.messagesToRemove.length > 0 ? (
                        truncatePreview.messagesToRemove.map((m) => (
                          <div key={m.index} className="whitespace-nowrap py-0.5 text-xs text-muted-foreground">
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
                    {/* 回滚被跳过的原因（诚实降级：不再静默，用户明确知道文件不会回滚） */}
                    {truncatePreview?.rollbackSkippedReason && (
                      <div className="mb-1 rounded-md border border-amber-300/60 bg-amber-50/60 px-2 py-1.5 text-xs text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400">
                        {truncatePreview.rollbackSkippedReason === 'no-file-history'
                          ? t('task.truncateSkipNoHistory')
                          : t('task.truncateSkipNoTimestamp')}
                      </div>
                    )}
                    <div className="no-scrollbar max-h-32 overflow-auto rounded-md border border-border p-2">
                      {truncatePreview && truncatePreview.fileChanges.length > 0 ? (
                        truncatePreview.fileChanges.map((f) => (
                          <div key={`${f.absPath}-${f.timestamp}`} className="whitespace-nowrap py-0.5 text-xs text-muted-foreground">
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
            </DialogBody>
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

        {/* 手动压缩确认框：预估压缩范围/收益/保留尾部 */}
        <Dialog open={compactDialogOpen} onOpenChange={(open) => !compacting && setCompactDialogOpen(open)}>
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-1.5">
                <Package className="size-4 text-primary-strong" />
                {t('context.compactDialogTitle')}
              </DialogTitle>
              <DialogDescription>{t('context.compactDialogDesc')}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              {compactPreviewLoading ? (
                <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>{t('context.compactPreviewLoading')}</span>
                </div>
              ) : compactPreview && compactPreview.compactableCount > 0 ? (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md border border-border p-2">
                      <div className="text-muted-foreground">{t('context.compactableMessages')}</div>
                      <div className="mt-0.5 text-base font-medium tabular-nums text-foreground">
                        {compactPreview.compactableCount}
                      </div>
                    </div>
                    <div className="rounded-md border border-border p-2">
                      <div className="text-muted-foreground">{t('context.compactableTokens')}</div>
                      <div className="mt-0.5 text-base font-medium tabular-nums text-foreground">
                        ~{compactPreview.compactableTokens.toLocaleString()}
                      </div>
                    </div>
                    <div className="rounded-md border border-border p-2">
                      <div className="text-muted-foreground">{t('context.tailKeepCount')}</div>
                      <div className="mt-0.5 text-base font-medium tabular-nums text-foreground">
                        {compactPreview.tailKeepCount}
                      </div>
                    </div>
                    <div className="rounded-md border border-border p-2">
                      <div className="text-muted-foreground">{t('context.estimatedAfter')}</div>
                      <div className="mt-0.5 text-base font-medium tabular-nums text-emerald-500">
                        ~{compactPreview.estimatedAfterTokens.toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2 text-xs leading-relaxed text-muted-foreground">
                    {t('context.compactDialogNote')}
                  </div>
                </>
              ) : (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  {t('context.compactNothing')}
                </div>
              )}
            </DialogBody>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCompactDialogOpen(false)}
                disabled={compacting}
              >
                {t('task.truncateCancel')}
              </Button>
              <Button
                size="sm"
                onClick={handleCompactConfirm}
                disabled={compacting || compactPreviewLoading || !compactPreview || compactPreview.compactableCount === 0}
              >
                {compacting ? <Loader2 className="size-3.5 animate-spin" /> : <Package className="size-3.5" />}
                {t('context.compactConfirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 通用中控岛：独立于发送框的平级组件（todo / ask / 权限确认），默认折叠 */}
        <div className="shrink-0 px-3">
          <ControlHub
            status={
              isGenerating ? (
                <>
                  <Loader2 className="size-3.5 animate-spin text-primary-strong" />
                  <span className="text-xs font-medium text-primary-strong">{t('hub.statusRunning')}</span>
                </>
              ) : (
                <>
                  <Circle className="size-2.5 fill-current text-muted-foreground/50" />
                  <span className="text-xs font-medium text-muted-foreground">{t('hub.statusIdle')}</span>
                </>
              )
            }
            activeModuleId={hubActiveModule}
            onActiveModuleChange={handleHubModuleChange}
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
                    <div className="flex flex-col gap-2">
                      {todos.map((item) => (
                        <TodoRow key={item.id} item={item} />
                      ))}
                    </div>
                  ),
              },
              // 队列模块：排队等待发送的消息，仅当队列非空时出现
              ...(messageQueue.length > 0
                ? [
                    {
                      id: 'queue',
                      icon: Inbox,
                      title: t('hub.queueModule'),
                      badge: messageQueue.length,
                      render: () => (
                        <div className="flex flex-col gap-2">
                          {messageQueue.map((msg) => (
                            <div
                              key={msg.id}
                              className="group flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-2"
                            >
                              <Inbox className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="truncate text-xs text-foreground">{msg.content}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {new Date(msg.timestamp).toLocaleTimeString()}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeFromMessageQueue(taskId, msg.id)}
                                className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                                title={t('hub.removeFromQueue')}
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ),
                    },
                  ]
                : []),
              // ask 模块：动态独立分类，仅当存在待回答提问时出现
              ...(pendingAsks.filter((a) => a.sessionId === taskId).length > 0
                ? [
                    {
                      id: 'ask',
                      icon: HelpCircle,
                      title: t('hub.askModule'),
                      badge: pendingAsks.filter((a) => a.sessionId === taskId).length,
                      render: () => (
                        <div className="flex flex-col gap-2.5">
                          {pendingAsks
                            .filter((a) => a.sessionId === taskId)
                            .map((ask) => (
                              <AskPromptCard
                                key={ask.toolCallId}
                                ask={ask}
                                className="border-0 bg-transparent p-0 shadow-none"
                              />
                            ))}
                        </div>
                      ),
                    },
                  ]
                : []),
              {
                id: 'permission',
                icon: ShieldCheck,
                title: t('hub.permissionModule'),
                badge: pendingConfirms.filter((c) => c.sessionId === taskId).length,
                render: () => {
                  const confirms = pendingConfirms.filter((c) => c.sessionId === taskId);
                  if (confirms.length === 0) {
                    return (
                      <div className="flex items-center gap-1.5 px-1 py-2 text-xs text-muted-foreground">
                        <ShieldCheck className="size-3.5" />
                        {t('hub.noPending')}
                      </div>
                    );
                  }
                  return (
                    <div className="flex flex-col gap-2.5">
                      {confirms.map((cf) => (
                        <ConfirmPromptCard
                          key={cf.toolCallId}
                          confirm={cf}
                          className="border-0 bg-transparent p-0 shadow-none"
                        />
                      ))}
                    </div>
                  );
                },
              },
            ]}
          />
        </div>

        {/* Task Input */}
        <div className="shrink-0 p-3 pt-1.5">
          <TaskInput
            variant="task"
            isGenerating={isGenerating}
            showDirectoryBadge={messages.length === 0 && !isGenerating}
            onAbort={() => abort(taskId)}
            onOpenOverlay={onOpenOverlay}
            onSend={handleSend}
          />
          {/* 运行指标栏（轮/步/耗时累计 + 引擎实时 token/命中） */}
          <StatsBar stats={runStats} contextStats={contextStats} />
        </div>
      </div>

      {/* Right Panel — 移动端：Sheet 抽屉；桌面端：内嵌 aside */}
      {isMobile ? (
        <Sheet open={rightPanelOpen} onOpenChange={(open) => setRightPanelOpen(taskId, open)}>
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
        // 常驻渲染 + 宽度过渡（替代条件挂载的瞬跳）：收起时 width=0 由 overflow-hidden 裁切。
        // 拖拽调宽时移除 transition 保证跟手；invisible 离散过渡：收起动画播完才隐藏、展开立即显示
        <aside
          className={cn(
            'anim-panel relative flex flex-col overflow-hidden border-l border-border bg-card',
            !rightResize.resizing && 'transition-[width,visibility] duration-200 ease-out',
            !rightPanelOpen && 'invisible',
          )}
          style={{ width: rightPanelOpen ? rightPanelWidth : 0 }}
          aria-hidden={!rightPanelOpen}
        >
          <div
            {...rightResize.bind}
            className="absolute inset-y-0 -left-[3px] z-10 w-1.5 cursor-col-resize touch-none select-none after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:-translate-x-1/2 after:bg-transparent hover:after:bg-border"
          />
          {/* 内容固定宽度 wrapper：宽度动画期间内容不被挤压变形（外层裁切） */}
          <div className="flex h-full min-h-0 flex-col overflow-hidden" style={{ width: rightPanelWidth }}>
            {rightPanelContent}
          </div>
        </aside>
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

/** token 数人性化：1048576→1M、1572864→1.5M、2299→2.3k、100000→100k、194→194 */
function formatTokens(n: number): string {
  const trim = (s: string) => (s.endsWith('.0') ? s.slice(0, -2) : s);
  if (n >= 1_000_000) return trim((n / 1_000_000).toFixed(1)) + 'M';
  if (n >= 1_000) return trim((n / 1_000).toFixed(1)) + 'k';
  return String(n);
}

/** 占用百分比分级精度：≥1% 取整；0.1%~1% 保留 1 位小数；<0.1% 显示下限标记。
 *  修复大窗口低占用时 Math.round 抹成 0% 的缺陷 */
function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return '0%';
  const pct = ratio * 100;
  if (pct >= 1) return `${Math.round(pct)}%`;
  if (pct >= 0.1) return `${pct.toFixed(1)}%`;
  return '<0.1%';
}

/** token 构成堆叠条：system/env/summary/history 分段配色 + 占用百分比。
 *  分段宽度基于上下文窗口：各段之和 = 实际占用，剩余空白 = 未占用。
 *  统一口径：usedTokens（LLM 真实上报 promptTokens）优先于 breakdown 估算，
 *  与底部 StatsBar"输入"同源同值；无样本时回退发送视图估算。
 *  悬停显示完整占用明细：分段构成/剩余可用/上次请求/缓存命中/自动压缩阈值 */
function ContextStackedBar({ stats }: { stats: ContextStats }) {
  const { t } = useTranslation();
  const { breakdown, windowTokens, lastUsage, avgHitRate, compaction } = stats;
  const window = Math.max(1, windowTokens);
  const usedTokens = lastUsage?.promptTokens ?? null;
  const total = usedTokens && usedTokens > 0 ? usedTokens : breakdown.total;
  // 分段按 breakdown 占比缩放到 total（真实占用与估算存在系统性偏差时保持构成比例）
  const scale = breakdown.total > 0 ? total / breakdown.total : 0;
  const segments = [
    { key: 'system', value: breakdown.system, color: 'bg-blue-700', label: t('context.segSystem') },
    { key: 'env', value: breakdown.env, color: 'bg-teal-500', label: t('context.segEnv') },
    { key: 'summary', value: breakdown.summary, color: 'bg-amber-500', label: t('context.segSummary') },
    { key: 'history', value: breakdown.history, color: 'bg-blue-500', label: t('context.segHistory') },
  ];
  const percentText = formatPercent(total / window);
  const usedText = formatTokens(total);
  const windowText = formatTokens(windowTokens);
  // 悬停完整明细（原生 title 支持 \n 多行）：占用 + 分段 + 剩余 + 上次请求 + 缓存命中 + 压缩阈值
  const titleLines: string[] = [
    t('context.usageTitle', { used: usedText, total: windowText, percent: percentText }),
    ...segments.map((s) => `${s.label}: ${formatTokens(s.value)}`),
    t('context.hoverRemaining', { remaining: formatTokens(Math.max(0, window - total)) }),
  ];
  if (lastUsage) {
    titleLines.push(
      t('context.hoverLastUsage', {
        prompt: formatTokens(lastUsage.promptTokens),
        completion: formatTokens(lastUsage.completionTokens),
        cached: formatTokens(lastUsage.cachedTokens),
      }),
    );
  }
  if (lastUsage && avgHitRate != null) {
    titleLines.push(
      t('context.hoverCacheHit', {
        rate: formatPercent(lastUsage.promptTokens > 0 ? lastUsage.cachedTokens / lastUsage.promptTokens : 0),
        avg: formatPercent(avgHitRate),
      }),
    );
  }
  if (compaction?.enabled) {
    const threshold = window * compaction.compactRatio;
    const left = threshold - total;
    titleLines.push(
      left >= 0
        ? t('context.hoverCompactThreshold', {
            threshold: formatTokens(threshold),
            left: formatTokens(left),
          })
        : t('context.hoverCompactReached', { threshold: formatTokens(threshold) }),
    );
  }
  const barTitle = titleLines.join('\n');
  return (
    <div className="flex flex-1 items-center gap-2">
      <div
        className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted"
        title={barTitle}
      >
        {segments.map((s) => (
          <div
            key={s.key}
            className={s.color}
            style={{ width: `${Math.min(100, ((s.value * scale) / window) * 100)}%` }}
          />
        ))}
      </div>
      <span
        className="text-xs tabular-nums text-muted-foreground"
        title={barTitle}
      >
        {percentText}
      </span>
    </div>
  );
}

/** 系统上下文分段折叠栏（「系统」标签页内的动态一栏栏） */
function SystemSectionItem({
  section,
}: {
  section: { id: string; title: string; tokens: number; content: string; defaultOpen?: boolean };
}) {
  return (
    <Collapsible defaultOpen={section.defaultOpen}>
      <CollapsibleTrigger className="group flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:text-foreground">
        <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
        <span className="truncate font-medium">{section.title}</span>
        <span className="ml-auto shrink-0 tabular-nums">~{section.tokens}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed">
          {section.content}
        </div>
      </CollapsibleContent>
    </Collapsible>
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
  /** 轮数触顶卡「继续执行」：发送继续消息起新 run（轮数重新计数） */
  onContinue?: () => void;
  /** 生成中禁用继续按钮（防并发 run） */
  continueDisabled?: boolean;
}
const MessageBubble = memo(function MessageBubble({ message, todos, toolIconMap, truncateDisabled, onTruncate, onCopy, onContinue, continueDisabled }: MessageBubbleProps) {
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
  // 用户消息尾部附件块解析（TaskInput 发送时生成：空行 + 标签行 + "- 绝对路径"行）。
  // 标签行文本随 i18n 变化，故按结构匹配；路径特征校验（盘符 / Unix 根）避免误伤普通列表。
  const userAttachments = message.role === 'user' ? parseAttachmentBlock(message.content) : null;
  const userBody = userAttachments ? userAttachments.body : message.content;
  const userBodyOverLimit = userBody.length > MAX_RENDER_CHARS;
  const userBodyDisplay = userBodyOverLimit && !expanded
    ? message.streaming
      ? '…' + userBody.slice(-MAX_RENDER_CHARS)
      : userBody.slice(0, MAX_RENDER_CHARS) + '…'
    : userBody;

  // 系统提示消息：居中气泡（防御性保留；skill 持久模式已废弃，正常流程不再产生）
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
  // 上下文压缩卡片：独立于普通气泡的居中卡片（前后 token 对比 + 摘要可展开）
  if (message.compaction) {
    return <CompactionCard compaction={message.compaction} />;
  }
  // 轮数触顶提示卡：居中卡片（上限说明 + 继续执行按钮）
  if (message.maxTurnsNotice) {
    return (
      <MaxTurnsNoticeCard
        notice={message.maxTurnsNotice}
        onContinue={onContinue}
        disabled={continueDisabled}
      />
    );
  }
  // 防御：tool 已被适配层合并进 assistant；此处不应出现
  if (message.role === 'tool') return null;
  if (message.role === 'user') {
    return (
      <div className="group flex flex-col items-end gap-1">
        <div className="max-w-[80%] rounded-2xl border border-border bg-indigo-100 px-3 py-2 text-sm text-foreground shadow-sm break-words whitespace-pre-wrap dark:bg-blue-600 dark:text-white dark:shadow-[0_2px_14px_rgba(37,99,235,0.35)]">
        {userBodyDisplay}
        {userAttachments && userAttachments.paths.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {userAttachments.paths.map((p) => (
              <div
                key={p}
                className="flex items-center gap-1.5 rounded-md border border-foreground/10 bg-foreground/5 px-2 py-1"
                title={p}
              >
                <Paperclip className="size-3 shrink-0 opacity-70" />
                <span className="truncate font-mono text-xs">{p}</span>
              </div>
            ))}
          </div>
        )}
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
          <div className="mt-1">
            <MarkdownRenderer text={message.thinking} streaming={!!message.thinkingStreaming} variant="compact" />
          </div>
        </details>
      )}
      {/* 正文 */}
      {message.content && !message.isError && (
        <div className="text-sm text-foreground">
          {/* 流式 spinner 经 cursor 渲染进文本流末尾，与最后一行文字同行（见 MarkdownRenderer / markdown.css） */}
          <MarkdownRenderer
            text={displayContent}
            streaming={!!message.streaming}
            cursor={message.streaming ? <Loader2 className="ml-1 inline size-3 animate-spin" /> : undefined}
          />
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
              <HelpCircle className="size-3.5 text-primary-strong" />
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
                  ) : isError ? (
                    <CircleAlert className="size-3.5 text-destructive" />
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
      {/* 错误消息（无背景无边框，保持红色文字；历史恢复经 http.ts 保留 isError） */}
      {message.isError && (
        <div className="whitespace-pre-wrap break-words text-xs text-destructive">
          {message.content}
        </div>
      )}
    </div>
  );
});
