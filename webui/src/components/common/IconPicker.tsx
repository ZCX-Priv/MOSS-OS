// webui/src/components/common/IconPicker.tsx
// 可复用 lucide 图标选择器：全量图标（1700+）+ 搜索 + 分页网格。
// value/onChange 均为 kebab-case 图标名（如 'calendar-clock'）。
// 供自动化任务表单及未来任意需要选图标的场景复用。
// 注意：弹出层为内联展开面板（非 Popover Portal）——modal Dialog 内
// react-remove-scroll 会拦截 Portal 外的 wheel 事件导致无法滚动。

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsUpDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ALL_ICON_NAMES, getLucideIcon } from '../../lib/icons';

/** 无搜索时每页渲染数量 */
const PAGE_SIZE = 96;
/** 有搜索时渲染上限 */
const SEARCH_LIMIT = 200;

interface IconPickerProps {
  value?: string;
  /** 选中图标名（kebab-case）；传 undefined 表示取消选择（回退默认展示） */
  onChange: (name?: string) => void;
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

  /** 取消选择：清空图标（调用方回退默认展示，如标题首字符） */
  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(undefined);
    setOpen(false);
    resetPanelState();
  };

  return (
    <div className="flex flex-col gap-2">
      {/* 触发按钮：点击展开/收起内联面板 */}
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start gap-2 font-normal"
        disabled={disabled}
        onClick={() => setOpen((p) => !p)}
      >
        {CurrentIcon ? (
          <CurrentIcon className="size-4 shrink-0" />
        ) : (
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        )}
        <span className="truncate">{value || t('iconPicker.placeholder')}</span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-md opacity-60 transition-opacity hover:opacity-100"
            onClick={handleClear}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') handleClear(e as unknown as React.MouseEvent);
            }}
            title={t('iconPicker.clear')}
          >
            <X className="size-3.5" />
          </span>
        )}
      </Button>

      {/* 展开面板：搜索 + 滚动网格（内联渲染，处于 Dialog 子树内可正常滚动） */}
      {open && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('iconPicker.searchPlaceholder')}
            autoFocus
          />
          <div className="grid max-h-64 grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1 overflow-y-auto p-0.5">
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
            {shown.length === 0 && (
              <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
                {t('iconPicker.noResults')}
              </div>
            )}
          </div>
          {/* 加载更多 / 截断提示：网格下方固定区，始终可见 */}
          {!query && visibleCount < filtered.length && (
            <div className="shrink-0 p-1">
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
            <div className="shrink-0 p-1 text-center text-xs text-muted-foreground">
              {t('iconPicker.resultTruncated', { shown: SEARCH_LIMIT, total: filtered.length })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
