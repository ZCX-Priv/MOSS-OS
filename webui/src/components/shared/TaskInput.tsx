import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Mic,
  ArrowUp,
  ChevronDown,
  FolderOpen,
  FolderInput,
  Loader2,
  Square,
  Monitor,
  Paperclip,
  Image as ImageIcon,
  Video,
  Music,
  X,
  Zap,
  BookOpen,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import type { OverlayType } from '../../types';
import { useStore, SYSTEM_WORKING_DIRECTORY } from '../../store';
import { ModelSelector } from '../overlays/ModelSelector';
import { PermissionModeSelector } from '../overlays/PermissionModeSelector';
import { useDirectoryPicker } from '../../hooks/useDirectoryPicker';
import { DirectoryPickerDialog } from '../overlays/DirectoryPickerDialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  resolveWorkingDirectoryName,
  formatFileSize,
  getAttachmentKind,
  type AttachmentKind,
} from '@/lib/utils';
import { MentionMenu } from './MentionMenu';
import {
  detectTrigger,
  filterMentionItems,
  type MentionItem,
  type MentionKind,
  type TriggerMatch,
} from './mention-data';
import type { LucideIcon } from 'lucide-react';

interface AttachmentItem {
  id: string;
  name: string;
  size: number;
  kind: AttachmentKind;
}

interface MentionChip {
  id: string;
  kind: MentionKind;
  label: string;
  icon: LucideIcon;
}

/** chip 发送时拼接用的触发符 */
const MENTION_TRIGGER_CHAR: Record<MentionKind, string> = {
  command: '/',
  agent: '@',
  file: '#',
};

/** 卡片副标题用的大写扩展名（无扩展名显示 FILE） */
function attachmentExtLabel(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx <= 0 || idx === name.length - 1) return 'FILE';
  return name.slice(idx + 1).toUpperCase();
}

function AttachmentKindIcon({ kind }: { kind: AttachmentKind }) {
  switch (kind) {
    case 'image':
      return <ImageIcon className="size-4" />;
    case 'video':
      return <Video className="size-4" />;
    case 'audio':
      return <Music className="size-4" />;
    default:
      return <Paperclip className="size-4" />;
  }
}

interface TaskInputProps {
  placeholder?: string;
  onOpenOverlay?: (overlay: OverlayType) => void;
  variant?: 'home' | 'task';
  onSend?: (text: string) => void;
  isGenerating?: boolean;
  /** 仅首屏空白（会话无消息且未生成）时显示工作目录 Badge */
  showDirectoryBadge?: boolean;
  onAbort?: () => void;
}

export function TaskInput({
  placeholder,
  onOpenOverlay,
  variant = 'home',
  onSend,
  isGenerating = false,
  showDirectoryBadge = true,
  onAbort,
}: TaskInputProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const workingDirectory = useStore((s) => s.workingDirectory);
  const setWorkingDirectory = useStore((s) => s.setWorkingDirectory);
  const recentDirectories = useStore((s) => s.recentDirectories);
  const sendShortcut = useStore((s) => s.sendShortcut);
  const {
    inputRef,
    pickDirectory,
    onInputPicked,
    isResolving,
    candidates,
    selectCandidate,
    cancel,
  } = useDirectoryPicker();

  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      setAttachments((prev) => [
        ...prev,
        ...files.map((f, i) => ({
          id: `${Date.now()}-${i}-${f.name}`,
          name: f.name,
          size: f.size,
          kind: getAttachmentKind(f.name, f.type),
        })),
      ]);
    }
    // 重置 value，保证连续选择同一文件也能触发 onChange
    e.target.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  // ==========================================================================
  // / @ # 触发菜单 + 行内 chip
  // ==========================================================================
  const [chips, setChips] = useState<MentionChip[]>([]);
  const [trigger, setTrigger] = useState<TriggerMatch | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Esc 关闭后抑制同一 token 再次弹出（token 变化或消失后解除） */
  const suppressedTokenRef = useRef<number | null>(null);

  const mentionItems = trigger ? filterMentionItems(trigger.kind, trigger.query) : [];

  const recomputeTrigger = (value: string, cursor: number) => {
    const match = detectTrigger(value, cursor);
    if (!match) {
      suppressedTokenRef.current = null;
      setTrigger(null);
      return;
    }
    if (suppressedTokenRef.current === match.tokenStart) {
      setTrigger(null);
      return;
    }
    if (
      !trigger ||
      trigger.kind !== match.kind ||
      trigger.query !== match.query ||
      trigger.tokenStart !== match.tokenStart
    ) {
      setActiveIndex(0);
    }
    setTrigger(match);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    recomputeTrigger(e.target.value, e.target.selectionStart ?? e.target.value.length);
  };

  // 鼠标点击/方向键移动光标不改 value，也要重算触发状态
  const handleInputSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    recomputeTrigger(el.value, el.selectionStart ?? el.value.length);
  };

  const selectMention = (item: MentionItem) => {
    if (!trigger) return;
    const cursor = textareaRef.current?.selectionStart ?? input.length;
    const next = input.slice(0, trigger.tokenStart) + input.slice(cursor);
    const caret = trigger.tokenStart;
    setInput(next);
    setChips((prev) => [
      ...prev,
      { id: `${item.id}-${Date.now()}`, kind: item.kind, label: item.name, icon: item.icon },
    ]);
    setTrigger(null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(caret, caret);
      }
    });
  };

  const removeChip = (id: string) => {
    setChips((prev) => prev.filter((c) => c.id !== id));
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text && attachments.length === 0 && chips.length === 0) return;
    // chip 以 /Plan @Agent #file 约定前缀置于消息最前
    const chipLine = chips
      .map((c) => `${MENTION_TRIGGER_CHAR[c.kind]}${c.label}`)
      .join(' ');
    // 附件名以约定文本格式附加到消息末尾（本轮纯前端占位，真实路径传递后续接入）
    const attachmentLine =
      attachments.length > 0
        ? `${t('taskInput.attachmentTag')} ${attachments.map((a) => a.name).join(', ')}`
        : '';
    const message = [chipLine, text, attachmentLine].filter(Boolean).join('\n');
    onSend?.(message);
    setInput('');
    setAttachments([]);
    setChips([]);
  };

  const canSend = Boolean(input.trim()) || attachments.length > 0 || chips.length > 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 菜单打开时优先接管键盘：↑↓ 移动、Enter 选中、Esc 关闭（均不触发发送）
    if (trigger) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (mentionItems.length ? (i + 1) % mentionItems.length : 0));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) =>
          mentionItems.length ? (i - 1 + mentionItems.length) % mentionItems.length : 0,
        );
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        suppressedTokenRef.current = trigger.tokenStart;
        setTrigger(null);
        return;
      }
      if (e.key === 'Enter') {
        const item = mentionItems[Math.min(activeIndex, mentionItems.length - 1)];
        if (item) {
          e.preventDefault();
          selectMention(item);
          return;
        }
        // 无匹配项时 Enter 走原有发送/换行逻辑
      }
    }
    if (e.key !== 'Enter') return;
    if (sendShortcut === 'enter') {
      // Enter 发送，Shift+Enter 换行
      if (!e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    } else {
      // Ctrl/Cmd+Enter 发送，Enter 换行
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        handleSend();
      }
    }
  };

  const isSystemScope = !workingDirectory || workingDirectory === SYSTEM_WORKING_DIRECTORY;
  const folderLabel =
    resolveWorkingDirectoryName(workingDirectory) ?? t('directoryPicker.system');
  const showDirBadge = showDirectoryBadge && !isGenerating;

  const dirName = (path: string) => {
    const seg = path.split(/[\\/]/).filter(Boolean).pop();
    return seg ?? path;
  };

  const renderDirItem = (name: string, path: string, onSelect: () => void, icon?: React.ReactNode) => (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>
        <DropdownMenuItem onSelect={onSelect} className="gap-2 py-1.5">
          {icon ?? <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />}
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{name}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">{path}</span>
          </div>
        </DropdownMenuItem>
      </TooltipTrigger>
      <TooltipContent side="right">
        <span className="font-mono">{path}</span>
      </TooltipContent>
    </Tooltip>
  );

  return (
    <>
    <Card className="relative w-full gap-0 overflow-visible rounded-2xl border border-border bg-transparent p-2 shadow-none ring-0">
      {trigger && (
        <MentionMenu
          items={mentionItems}
          activeIndex={activeIndex}
          onHover={setActiveIndex}
          onSelect={selectMention}
        />
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1 pt-1">
          {attachments.map((a) => (
            <Tooltip key={a.id} delayDuration={400}>
              <TooltipTrigger asChild>
                <div className="relative flex w-56 items-center gap-2 rounded-xl border border-border bg-muted/50 py-2 pl-2 pr-3 transition-colors duration-150 hover:border-foreground/20">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background/80 text-muted-foreground">
                    <AttachmentKindIcon kind={a.kind} />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-medium leading-tight">
                      {a.name}
                    </span>
                    <span className="text-[11px] leading-tight text-muted-foreground">
                      {attachmentExtLabel(a.name)} · {formatFileSize(a.size)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.id)}
                    className="absolute -right-1.5 -top-1.5 flex size-[18px] cursor-pointer items-center justify-center rounded-full border border-border bg-popover text-muted-foreground shadow-sm transition-colors duration-150 hover:text-foreground"
                    title={t('taskInput.removeAttachment')}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs break-all">
                {a.name}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-start gap-1">
        {chips.map((chip) => {
          const ChipIcon = chip.icon;
          return (
            <span
              key={chip.id}
              className="mt-1.5 inline-flex h-6 items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 text-xs"
            >
              <ChipIcon className="size-3 shrink-0 text-muted-foreground" />
              <span className="max-w-36 truncate">{chip.label}</span>
              <button
                type="button"
                onClick={() => removeChip(chip.id)}
                className="flex cursor-pointer items-center justify-center text-muted-foreground transition-colors duration-150 hover:text-foreground"
                title={t('taskInput.removeMention')}
              >
                <X className="size-3" />
              </button>
            </span>
          );
        })}
        <Textarea
          ref={textareaRef}
          placeholder={placeholder ?? t('taskInput.placeholder')}
          value={input}
          onChange={handleInputChange}
          onSelect={handleInputSelect}
          onKeyDown={handleKeyDown}
          rows={variant === 'home' ? 3 : 4}
          className="w-auto min-w-40 max-h-[40vh] flex-1 basis-40 resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2 px-1 pt-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" title={t('common.attachment')}>
                <Plus />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              collisionPadding={8}
              className="w-auto min-w-[220px] rounded-xl p-1"
            >
              <DropdownMenuItem
                onSelect={() => fileInputRef.current?.click()}
                className="gap-2 rounded-lg px-2.5 py-1.5 text-[13px]"
              >
                <Paperclip className="size-4 text-muted-foreground" />
                <span>{t('taskInput.uploadAttachment')}</span>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2 rounded-lg px-2.5 py-1.5 text-[13px]">
                  <Zap className="size-4 text-muted-foreground" />
                  <span>{t('taskInput.commands')}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  sideOffset={8}
                  collisionPadding={8}
                  className="w-auto min-w-[200px] rounded-xl"
                >
                  <div className="flex flex-col items-center gap-2 px-6 py-8">
                    <Zap className="size-5 text-muted-foreground/50" />
                    <span className="text-xs text-muted-foreground">
                      {t('taskInput.noCommands')}
                    </span>
                  </div>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2 rounded-lg px-2.5 py-1.5 text-[13px]">
                  <BookOpen className="size-4 text-muted-foreground" />
                  <span>{t('taskInput.skills')}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  sideOffset={8}
                  collisionPadding={8}
                  className="w-auto min-w-[200px] rounded-xl"
                >
                  <div className="flex flex-col items-center gap-2 px-6 py-8">
                    <BookOpen className="size-5 text-muted-foreground/50" />
                    <span className="text-xs text-muted-foreground">
                      {t('taskInput.noSkills')}
                    </span>
                  </div>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
          <PermissionModeSelector fullLabel={!showDirBadge} />
          {showDirBadge && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Badge
                variant="secondary"
                className="min-w-0 shrink gap-1 h-7 rounded-[min(var(--radius-md),12px)] border border-border bg-transparent px-3 py-1 font-normal cursor-pointer [&>svg]:size-3.5"
                title={
                  isSystemScope
                    ? t('directoryPicker.systemTitle')
                    : workingDirectory
                }
              >
                {isResolving ? (
                  <Loader2 className="size-3 shrink-0 animate-spin" />
                ) : isSystemScope ? (
                  <Monitor className="size-3 shrink-0" />
                ) : (
                  <FolderOpen className="size-3 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{folderLabel}</span>
                <ChevronDown className="size-3 shrink-0 opacity-70" />
              </Badge>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" collisionPadding={8} className="min-w-[18rem]">
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                {t('directoryPicker.recent')}
              </div>
              {renderDirItem(
                t('directoryPicker.system'),
                t('directoryPicker.systemDesc'),
                () => setWorkingDirectory(SYSTEM_WORKING_DIRECTORY),
                <Monitor key="system" className="size-3.5 shrink-0 text-muted-foreground" />,
              )}
              {recentDirectories.length > 0 && (
                <div className="max-h-[10.5rem] overflow-y-auto pr-1">
                  {recentDirectories.map((dir) => (
                    <div key={dir}>
                      {renderDirItem(dirName(dir), dir, () => setWorkingDirectory(dir))}
                    </div>
                  ))}
                </div>
              )}
              <DropdownMenuSeparator className="mx-2" />
              <DropdownMenuItem onSelect={() => pickDirectory()} className="gap-1.5">
                <FolderInput className="size-3.5" />
                <span>{t('directoryPicker.pickFolder')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          )}
          <input
            ref={inputRef}
            type="file"
            webkitdirectory=""
            directory=""
            multiple
            className="hidden"
            onChange={onInputPicked}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFilesPicked}
          />
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <ModelSelector />
          <Button variant="ghost" size="icon-sm" title={t('common.voiceInput')}>
            <Mic />
          </Button>
          {isGenerating ? (
            <Button
              size="icon-sm"
              variant="destructive"
              onClick={onAbort}
              title={t('common.stop')}
              disabled={!onAbort}
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              variant={canSend ? 'default' : 'secondary'}
              onClick={handleSend}
              title={t('common.send')}
              disabled={!canSend}
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </Card>
    <DirectoryPickerDialog
      open={candidates.length > 0}
      candidates={candidates}
      onSelect={selectCandidate}
      onClose={cancel}
    />
    </>
  );
}
