// UI/src/components/shared/TerminalView.tsx
// 终端标签页：联动后端展示 agent 执行的 shell 命令与结果（只读，类真实终端视觉）

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useStore } from '../../store';
import type { TaskMessage, ToolCall, ToolResult } from '../../types/api';
import { ansiToHtml, parseShellResult, parseShellCommand } from '@/lib/ansi';

// 稳定引用的空数组，避免 useStore 选择器每次返回新 [] 触发 useSyncExternalStore 无限循环
const EMPTY_MESSAGES: TaskMessage[] = [];

interface ShellEntry {
  tc: ToolCall;
  result?: ToolResult;
}

interface TerminalViewProps {
  /** 可选：仅展示该 toolCallId 的命令；缺省则展示当前 session 所有 shell 调用 */
  toolCallId?: string;
}

export function TerminalView({ toolCallId }: TerminalViewProps) {
  const { t } = useTranslation();
  const sessionId = useStore((s) => s.activeSessionId);
  const messages = useStore(
    (s) => s.messagesBySession[sessionId ?? ''] ?? EMPTY_MESSAGES,
  );

  // 收集所有 shell toolCalls（按消息顺序 + 消息内顺序）
  const shellEntries = useMemo<ShellEntry[]>(() => {
    const entries: ShellEntry[] = [];
    for (const msg of messages) {
      if (!msg.toolCalls) continue;
      for (const tc of msg.toolCalls) {
        if (tc.name !== 'shell') continue;
        if (toolCallId && tc.id !== toolCallId) continue;
        const tr = msg.toolResults?.find((r) => r.toolCallId === tc.id);
        entries.push({ tc, result: tr?.result });
      }
    }
    return entries;
  }, [messages, toolCallId]);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-950 p-3 font-mono text-xs leading-relaxed">
      {shellEntries.length === 0 ? (
        <div className="text-zinc-500">{t('terminal.empty')}</div>
      ) : (
        <div className="flex flex-col gap-3">
          {shellEntries.map(({ tc, result }) => (
            <TerminalEntry key={tc.id} tc={tc} result={result} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 渲染单个 shell 命令调用 */
function TerminalEntry({ tc, result }: { tc: ToolCall; result?: ToolResult }) {
  const { t } = useTranslation();
  const command = parseShellCommand(tc.arguments);
  const cwd = result?.metadata?.cwd;
  const isRunning = tc.status === 'generating' || tc.status === 'executing';

  // 解析结果文本（仅 done 后有 result）
  const resultText = result?.content
    .filter((c) => c.type === 'text')
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('\n') ?? '';
  const parsed = resultText ? parseShellResult(resultText) : null;
  const exitCode = parsed?.exitCode ?? result?.metadata?.exitCode;
  const isError = result?.isError || (exitCode !== undefined && exitCode !== 0);

  return (
    <div className="flex flex-col gap-1">
      {/* 命令行 */}
      <div className="flex items-start gap-1.5">
        <span className="select-none text-green-400">$</span>
        <div className="flex-1 break-all">
          {cwd && (
            <span className="select-none text-zinc-500">
              {cwd}
              {'\n'}
            </span>
          )}
          <span className="text-zinc-100">{command || t('terminal.generating')}</span>
        </div>
      </div>

      {/* 执行中状态 */}
      {isRunning && (
        <div className="flex items-center gap-1.5 text-zinc-400">
          <Loader2 className="size-3 animate-spin" />
          <span>
            {tc.status === 'generating'
              ? t('terminal.generating')
              : t('terminal.executing')}
          </span>
        </div>
      )}

      {/* 完成输出 */}
      {parsed && (
        <div className="flex flex-col gap-1">
          {parsed.stdout && (
            <pre
              className="whitespace-pre-wrap break-all text-zinc-200"
              dangerouslySetInnerHTML={{ __html: ansiToHtml(parsed.stdout) }}
            />
          )}
          {parsed.stderr && (
            <pre
              className="whitespace-pre-wrap break-all text-red-400"
              dangerouslySetInnerHTML={{ __html: ansiToHtml(parsed.stderr) }}
            />
          )}
          {parsed.stdout === '' && parsed.stderr === '' && (
            <span className="text-zinc-600">{t('terminal.emptyOutput')}</span>
          )}
          {/* 退出码标记 */}
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className={isError ? 'text-red-400' : 'text-zinc-500'}>
              [{t('terminal.exitCode')}: {exitCode ?? 0}]
            </span>
            {result?.metadata?.truncated && (
              <span className="text-yellow-500/80">{t('terminal.truncated')}</span>
            )}
            {result?.metadata?.timedOut && (
              <span className="text-yellow-500/80">{t('terminal.timedOut')}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
