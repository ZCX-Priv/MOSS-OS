import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Code, FolderOpen, MessageSquare } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { api } from '@/api/http';
import type { TaskItem } from '@/types/api';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
}

interface MessageHit {
  sessionId: string;
  messageId: string;
  text: string;
}

export function SearchModal({ open, onClose, onOpenTask }: SearchModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [messages, setMessages] = useState<MessageHit[]>([]);
  const [allTasks, setAllTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      // 重置状态
      setQuery('');
      setTasks([]);
      setMessages([]);
      setAllTasks([]);
      return;
    }
    // 打开时加载所有会话记录
    void api
      .listTasks()
      .then((resp) => setAllTasks(resp.tasks ?? []))
      .catch(() => setAllTasks([]));
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setTasks([]);
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await api.search(query.trim());
        setTasks(result.tasks ?? []);
        setMessages(result.messages ?? []);
      } catch (err) {
        console.warn('search failed:', err);
        setTasks([]);
        setMessages([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const hasResults = tasks.length > 0 || messages.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md h-[80svh] max-h-[600px] sm:h-[600px]">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('search.placeholder')}</DialogTitle>
        </DialogHeader>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t('search.placeholder')}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="flex-1 min-h-0 max-h-none">
            {/* query 为空：显示所有会话记录 */}
            {!query.trim() && allTasks.length > 0 && (
              <CommandGroup heading={t('search.allTasks')}>
                {allTasks.map((task) => (
                  <CommandItem
                    key={task.id}
                    value={`${task.title} ${task.groupId ?? ''}`}
                    onSelect={() => {
                      onOpenTask(task.id);
                      onClose();
                    }}
                  >
                    <Code />
                    <span className="flex-1 truncate">{task.title}</span>
                    {task.groupId && (
                      <Badge variant="secondary" className="gap-1 font-normal">
                        <FolderOpen className="size-3" />
                        {task.groupId}
                      </Badge>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!loading && !hasResults && query.trim() && (
              <CommandEmpty>{t('search.noResults')}</CommandEmpty>
            )}
            {loading && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t('search.searching')}
              </div>
            )}
            {!loading && tasks.length > 0 && (
              <CommandGroup heading={t('search.tasks')}>
                {tasks.map((task) => (
                  <CommandItem
                    key={task.id}
                    value={`${task.title} ${task.groupId ?? ''}`}
                    onSelect={() => {
                      onOpenTask(task.id);
                      onClose();
                    }}
                  >
                    <Code />
                    <span className="flex-1 truncate">{task.title}</span>
                    {task.groupId && (
                      <Badge variant="secondary" className="gap-1 font-normal">
                        <FolderOpen className="size-3" />
                        {task.groupId}
                      </Badge>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!loading && messages.length > 0 && (
              <CommandGroup heading={t('search.messages')}>
                {messages.map((msg) => (
                  <CommandItem
                    key={msg.messageId}
                    value={msg.text}
                    onSelect={() => {
                      onOpenTask(msg.sessionId);
                      onClose();
                    }}
                  >
                    <MessageSquare />
                    <span className="flex-1 truncate">{msg.text}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
