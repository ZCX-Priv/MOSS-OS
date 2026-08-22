// webui/src/components/common/IconPicker.tsx
// 可复用 lucide 图标选择器：全量图标（1700+）+ 搜索 + 分页网格。
// value/onChange 均为 kebab-case 图标名（如 'calendar-clock'）。
// 供自动化任务表单及未来任意需要选图标的场景复用。

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ALL_ICON_NAMES, getLucideIcon } from '../../lib/icons';

/** 无搜索时每页渲染数量 */
const PAGE_SIZE = 96;
/** 有搜索时渲染上限 */
const SEARCH_LIMIT = 200;

interface IconPickerProps {
  value?: string;
  onChange: (name: string) => void;
  disabled?: boolean;
}

export function IconPicker({ value, onChange, disabled }: IconPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/[\s_-]/g, '');
    if (!q) return ALL_ICON_NAMES;
    return ALL_ICON_NAMES.filter((name) => name.replace(/-/g, '').includes(q));
  }, [query]);

  const limit = query ? Math.min(filtered.length, SEARCH_LIMIT) : visibleCount;
  const shown = filtered.slice(0, limit);
  const CurrentIcon = value ? getLucideIcon(value) : undefined;

  const resetPanelState = () => {
    setQuery('');
    setVisibleCount(PAGE_SIZE);
  };

  const handleSelect = (name: string) => {
    onChange(name);
    setOpen(false);
    resetPanelState();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) resetPanelState();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-start gap-2 font-normal"
          disabled={disabled}
        >
          {CurrentIcon ? (
            <CurrentIcon className="size-4 shrink-0" />
          ) : (
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          )}
          <span className="truncate">{value || t('iconPicker.placeholder')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="border-b p-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('iconPicker.searchPlaceholder')}
          />
        </div>
        <ScrollArea className="h-64">
          <div className="grid grid-cols-8 gap-1 p-2">
            {shown.map((name) => {
              const Icon = getLucideIcon(name);
              if (!Icon) return null;
              const selected = name === value;
              return (
                <button
                  key={name}
                  type="button"
                  title={name}
                  onClick={() => handleSelect(name)}
                  className={`flex size-9 items-center justify-center rounded-md border transition-colors hover:bg-accent ${
                    selected ? 'border-primary bg-primary/10 text-primary' : 'border-transparent'
                  }`}
                >
                  <Icon className="size-4" />
                </button>
              );
            })}
          </div>
          {shown.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t('iconPicker.noResults')}
            </div>
          )}
          {!query && visibleCount < filtered.length && (
            <div className="p-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                {t('iconPicker.loadMore')} ({Math.min(visibleCount, filtered.length)}/{filtered.length})
              </Button>
            </div>
          )}
          {query && filtered.length > SEARCH_LIMIT && (
            <div className="p-2 text-center text-xs text-muted-foreground">
              {t('iconPicker.resultTruncated', { shown: SEARCH_LIMIT, total: filtered.length })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
