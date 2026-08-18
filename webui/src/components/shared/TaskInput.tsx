import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Mic, ArrowUp, ChevronDown, FolderOpen, FolderInput, Loader2, Square, Monitor } from 'lucide-react';
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
} from '@/components/ui/dropdown-menu';
import type { OverlayType } from '../../types';
import { useStore, SYSTEM_WORKING_DIRECTORY } from '../../store';
import { ModelSelector } from '../overlays/ModelSelector';
import { PermissionModeSelector } from '../overlays/PermissionModeSelector';
import { useDirectoryPicker } from '../../hooks/useDirectoryPicker';
import { DirectoryPickerDialog } from '../overlays/DirectoryPickerDialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { resolveWorkingDirectoryName } from '@/lib/utils';

interface TaskInputProps {
  placeholder?: string;
  onOpenOverlay?: (overlay: OverlayType) => void;
  variant?: 'home' | 'task';
  onSend?: (text: string) => void;
  isGenerating?: boolean;
  onAbort?: () => void;
}

export function TaskInput({
  placeholder,
  onOpenOverlay,
  variant = 'home',
  onSend,
  isGenerating = false,
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

  const handleSend = () => {
    if (input.trim()) {
      onSend?.(input);
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
    <Card className="w-full gap-0 rounded-2xl border border-border bg-transparent p-2 shadow-none ring-0">
      <Textarea
        placeholder={placeholder ?? t('taskInput.placeholder')}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={variant === 'home' ? 3 : 4}
        className="max-h-[40vh] resize-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex min-w-0 items-center justify-between gap-2 px-1 pt-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button variant="ghost" size="icon-sm" title={t('common.attachment')}>
            <Plus />
          </Button>
          <PermissionModeSelector />
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
          <input
            ref={inputRef}
            type="file"
            webkitdirectory=""
            directory=""
            multiple
            className="hidden"
            onChange={onInputPicked}
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
              variant={input.trim() ? 'default' : 'secondary'}
              onClick={handleSend}
              title={t('common.send')}
              disabled={!input.trim()}
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
