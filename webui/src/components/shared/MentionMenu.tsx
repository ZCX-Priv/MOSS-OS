// webui/src/components/shared/MentionMenu.tsx
// / @ # 触发的上拉菜单：分组渲染 + hover/键盘高亮 + 空态。
// 视觉遵循项目 Token（bg-popover / ring-foreground/10 / text-muted-foreground）。

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { MentionGroup, MentionItem } from './mention-data';

interface MentionMenuProps {
  /** 已过滤的菜单项（保持分组顺序） */
  items: MentionItem[];
  /** 当前高亮项（扁平下标，跨分组连续编号） */
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (item: MentionItem) => void;
}

/** 组内项顺序保持传入顺序，跨组拼接为扁平下标 */
function groupItems(items: MentionItem[]): Array<{ group: MentionGroup; items: MentionItem[]; start: number }> {
  const sections: Array<{ group: MentionGroup; items: MentionItem[]; start: number }> = [];
  let flat = 0;
  for (const item of items) {
    const last = sections[sections.length - 1];
    if (last && last.group === item.group) {
      last.items.push(item);
    } else {
      sections.push({ group: item.group, items: [item], start: flat });
    }
    flat++;
  }
  return sections;
}

export function MentionMenu({ items, activeIndex, onHover, onSelect }: MentionMenuProps) {
  const { t } = useTranslation();
  const sections = groupItems(items);

  return (
    // onMouseDown preventDefault：避免点击菜单时 textarea blur 导致菜单提前关闭
    <div
      className="absolute bottom-full left-0 z-50 mb-2 w-full max-w-md rounded-xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100 animate-in fade-in-0 zoom-in-95"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="max-h-80 overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            {t('taskInput.noResults')}
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.group}>
              <div className="px-2 pb-0.5 pt-1.5 text-[11px] text-muted-foreground">
                {t(`taskInput.mentionGroups.${section.group}`)}
              </div>
              {section.items.map((item, i) => {
                const index = section.start + i;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => onHover(index)}
                    onClick={() => onSelect(item)}
                    className={cn(
                      'flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left transition-colors duration-100',
                      index === activeIndex ? 'bg-muted' : 'bg-transparent',
                    )}
                  >
                    <Icon className={cn('size-4 shrink-0', item.iconClass)} />
                    <span className="shrink-0 text-[13px] font-medium">{item.name}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {item.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
