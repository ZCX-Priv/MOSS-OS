import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import {
  Sparkles,
  ChevronRight,
  FileText,
  Info,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Loader2,
  HelpCircle,
  Atom,
} from 'lucide-react';
import { resolveToolIcon } from '@/lib/tool-icons';
import type { OverlayType } from '../../types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ChatInput } from '../shared/ChatInput';
import { TodoProgressCard } from '../shared/TodoProgressCard';
import { AskPromptCard } from '../shared/AskPromptCard';
import { useStore } from '../../store';
import { useChat } from '../../hooks/useChat';
import { api } from '../../api/http';
import { wsClient } from '../../api/ws';
import type { ChatMessage, TodoItem } from '../../types/api';

// 稳定引用的空数组，避免 useStore 选择器每次返回新 [] 触发 useSyncExternalStore 无限循环
const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_TODOS: TodoItem[] = [];

interface TaskRunningPageProps {
  onOpenOverlay: (overlay: OverlayType) => void;
}

export function TaskRunningPage({ onOpenOverlay }: TaskRunningPageProps) {
  const { t } = useTranslation();
  const { taskId = '' } = useParams<{ taskId: string }>();
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  const messages = useStore((s) => s.messagesBySession[taskId] ?? EMPTY_MESSAGES);
  const isGenerating = useStore((s) => s.generatingBySession[taskId] ?? false);
  const task = useStore((s) => s.tasks.find((tk) => tk.id === taskId));
  const todos = useStore((s) => s.todosBySession[taskId] ?? EMPTY_TODOS);
  const pendingAsks = useStore((s) => s.pendingAsks);
  const context = useStore((s) => s.contextBySession[taskId]);
  const { sendMessage, abort } = useChat();

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const contextFiles = context?.files ?? [];
  const totalTokens = context?.totalTokens ?? 0;
  const maxTokens = context?.maxTokens ?? 1;
  const contextPercent = maxTokens > 0 ? Math.round((totalTokens / maxTokens) * 100) : 0;

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Chat Area */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {/* Chat Header */}
        <div className="flex h-12 items-center justify-between border-b border-border px-4">
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
            {rightPanelOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </div>

        {/* Chat Messages */}
        <div className="min-h-0 flex-1 overflow-y-auto chat-scroll-area">
          <div className="flex flex-col gap-4 p-4">
            {messages.length === 0 && !isGenerating && (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                <Sparkles className="size-6" />
                <span className="text-sm">{t('task.emptyMessage')}</span>
              </div>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
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
          </div>
        </div>

        {/* Chat Input */}
        <div className="shrink-0 border-t border-border p-3">
          <ChatInput
            variant="task"
            isGenerating={isGenerating}
            onAbort={abort}
            onOpenOverlay={onOpenOverlay}
            onSend={(text) => sendMessage(text, { taskId })}
          />
        </div>
      </div>

      {/* Right Panel */}
      {rightPanelOpen && (
        <aside className="flex w-80 flex-col border-l border-border bg-card">
          {/* Panel Header */}
          <div className="flex h-12 items-center justify-between border-b border-border px-4">
            <h3 className="text-sm font-medium text-foreground">{t('task.taskSummary')}</h3>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" title={t('task.add')}>
                <Plus />
              </Button>
              <Button variant="ghost" size="icon-sm" title={t('task.expand')}>
                <Maximize2 className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* Todo Section */}
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
        </aside>
      )}
    </div>
  );
}

/** 渲染单条消息 */
function MessageBubble({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  // 获取当前 session 的 todos，用于在对话流中渲染 TodoProgressCard
  const todos = useStore((s) => s.todosBySession[s.activeSessionId ?? ''] ?? EMPTY_TODOS);
  const toolIconMap = useStore((s) => s.toolIconMap);

  // 防御：system 已被后端物理隔离、tool 已被适配层合并进 assistant；此处不应出现
  if (message.role === 'system' || message.role === 'tool') return null;
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground">
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
            <Atom className={cn('size-3.5', message.streaming && 'animate-spin')} />
            <span>{message.streaming ? '思考中' : '已完成思考'}</span>
          </summary>
          <div className="mt-1 text-xs text-muted-foreground">
            {message.thinking}
          </div>
        </details>
      )}
      {/* 正文 */}
      {message.content && !message.content.startsWith('Error:') && (
        <div className="whitespace-pre-wrap text-sm text-foreground">
          {message.content}
          {message.streaming && (
            <Loader2 className="ml-1 inline size-3 animate-spin" />
          )}
        </div>
      )}
      {/* todo 工具调用 → 在对话流中渲染 TodoProgressCard（像其他工具一样在调用位置显示） */}
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
                    <span className="text-muted-foreground/60">生成参数中…</span>
                  )}
                  {tc.status === 'executing' && (
                    <span className="text-muted-foreground/60">执行中…</span>
                  )}
                </summary>
                <div className="mt-1 flex flex-col gap-2 rounded-md border border-border p-2 text-xs max-h-[300px] overflow-auto no-scrollbar">
                  {tc.arguments && (
                    <div>
                      <div className="text-muted-foreground/70">参数</div>
                      <pre className="mono mt-0.5 whitespace-pre-wrap break-all text-foreground">
                        {prettyArgs}
                      </pre>
                    </div>
                  )}
                  {resultText && (
                    <div>
                      <div className={cn('text-muted-foreground/70', isError && 'text-destructive/80')}>
                        {isError ? '错误结果' : '结果'}
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
      {message.content.startsWith('Error:') && (
        <Card className="border-destructive/50 p-2 text-xs text-destructive">
          {message.content}
        </Card>
      )}
    </div>
  );
}
