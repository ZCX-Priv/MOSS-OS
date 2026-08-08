import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip, Mic, ArrowUp, ChevronDown, FolderOpen, FolderInput, Loader2, Square } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { OverlayType } from '../../types';
import { useStore } from '../../store';
import { ModelSelector } from '../overlays/ModelSelector';
import { useDirectoryPicker } from '../../hooks/useDirectoryPicker';
import { DirectoryPickerDialog } from '../overlays/DirectoryPickerDialog';

interface ChatInputProps {
  placeholder?: string;
  onOpenOverlay?: (overlay: OverlayType) => void;
  variant?: 'home' | 'task';
  onSend?: (text: string) => void;
  isGenerating?: boolean;
  onAbort?: () => void;
}

export function ChatInput({
  placeholder,
  onOpenOverlay,
  variant = 'home',
  onSend,
  isGenerating = false,
  onAbort,
}: ChatInputProps) {
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

  const folderLabel =
    workingDirectory.split(/[\\/]/).pop() || t('chatInput.selectFolder');

  return (
    <>
    <Card className="w-full gap-0 rounded-2xl p-2 shadow-sm">
      <Textarea
        placeholder={placeholder ?? t('chatInput.placeholder')}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={variant === 'home' ? 3 : 4}
        className="max-h-[40vh] resize-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between gap-2 px-1 pt-1.5">
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon-sm" title={t('common.attachment')}>
            <Paperclip />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Badge
                variant="secondary"
                className="gap-1 rounded-full px-2 py-1 font-normal cursor-pointer"
                title={workingDirectory || t('chatInput.selectFolder')}
              >
                {isResolving ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <FolderOpen className="size-3" />
                )}
                <span className="max-w-[10rem] truncate">{folderLabel}</span>
                <ChevronDown className="size-3 opacity-70" />
              </Badge>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" collisionPadding={8}>
              <div className="p-2">
                <Input
                  value={workingDirectory}
                  onChange={(e) => setWorkingDirectory(e.target.value)}
                  placeholder={t('chatInput.selectFolder')}
                  className="h-8 text-xs"
                />
              </div>
              <DropdownMenuItem onSelect={() => pickDirectory()} className="gap-1.5">
                <FolderInput className="size-3.5" />
                <span>{t('directoryPicker.pickFolder')}</span>
              </DropdownMenuItem>
              {recentDirectories.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1 text-[11px] text-muted-foreground">
                    {t('directoryPicker.recent')}
                  </div>
                  {recentDirectories.map((dir) => (
                    <DropdownMenuItem
                      key={dir}
                      onSelect={() => setWorkingDirectory(dir)}
                      className="gap-1.5"
                    >
                      <FolderOpen className="size-3.5 shrink-0" />
                      <span className="truncate font-mono text-xs">{dir}</span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
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
        <div className="flex items-center gap-1.5">
          <ModelSelector />
          <Button variant="ghost" size="icon-sm" title={t('common.voiceInput')}>
            <Mic />
          </Button>
          {isGenerating && !input.trim() ? (
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
