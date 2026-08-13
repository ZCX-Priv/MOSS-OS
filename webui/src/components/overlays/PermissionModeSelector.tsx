// UI/src/components/overlays/PermissionModeSelector.tsx
// 执行权限选择器：DropdownMenu 上拉菜单，参考 ModelSelector 布局。
// 5 种权限模式：询问/自动接受编辑/自动模式/计划模式/跳过权限。
// 状态持久化到 IndexedDB（经 store.setPermissionMode → idbSet）。

import { useTranslation } from 'react-i18next';
import {
  Shield,
  RefreshCw,
  TriangleAlert,
  ChevronDown,
  CheckCircle2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useStore } from '../../store';
import type { PermissionMode } from '../../types/api';

/** 权限模式配置 */
interface ModeConfig {
  id: PermissionMode;
  icon: LucideIcon;
  labelKey: string;
  descKey: string;
  badgeKey?: string;
  badgeClass?: string;
  iconClass?: string;
}

const MODE_CONFIG: ModeConfig[] = [
  {
    id: 'ask',
    icon: Shield,
    labelKey: 'permissionMode.ask.label',
    descKey: 'permissionMode.ask.desc',
  },
  {
    id: 'auto',
    icon: RefreshCw,
    labelKey: 'permissionMode.auto.label',
    descKey: 'permissionMode.auto.desc',
    badgeKey: 'permissionMode.auto.badge',
    badgeClass:
      'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  },
  {
    id: 'skip',
    icon: TriangleAlert,
    labelKey: 'permissionMode.skip.label',
    descKey: 'permissionMode.skip.desc',
    badgeKey: 'permissionMode.skip.badge',
    badgeClass:
      'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
    iconClass: 'text-orange-600 dark:text-orange-500',
  },
];

export function PermissionModeSelector() {
  const { t } = useTranslation();
  const permissionMode = useStore((s) => s.permissionMode);
  const setPermissionMode = useStore((s) => s.setPermissionMode);

  const currentConfig =
    MODE_CONFIG.find((m) => m.id === permissionMode) ?? MODE_CONFIG[0];
  const CurrentIcon = currentConfig.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Badge
          variant="secondary"
          className="min-w-0 shrink gap-1 h-7 rounded-[min(var(--radius-md),12px)] border border-border bg-transparent px-3 py-1 font-normal cursor-pointer [&>svg]:size-3.5"
          title={t('permissionMode.title')}
        >
          <CurrentIcon className="size-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate hidden sm:inline whitespace-nowrap">
            {t(currentConfig.labelKey)}
          </span>
          <ChevronDown className="size-3 shrink-0 opacity-70" />
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        className="min-w-[18rem] p-1"
      >
        <DropdownMenuLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          {t('permissionMode.title')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {MODE_CONFIG.map((mode) => {
          const isSelected = permissionMode === mode.id;
          const Icon = mode.icon;
          return (
            <DropdownMenuItem
              key={mode.id}
              onSelect={() => setPermissionMode(mode.id)}
              className={cn(
                'gap-2.5 px-2 py-1.5 focus:text-foreground focus:**:text-foreground!',
                isSelected && 'bg-muted text-foreground',
              )}
            >
              <Icon
                className={cn('size-4 shrink-0', mode.iconClass)}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm leading-tight">
                  {t(mode.labelKey)}
                </span>
                <span className="group-hover/dropdown-menu-item:text-muted-foreground! text-[11px] leading-tight text-muted-foreground">
                  {t(mode.descKey)}
                </span>
              </div>
              {mode.badgeKey && (
                <Badge
                  variant="secondary"
                  className={cn(
                    'shrink-0 border font-normal',
                    mode.badgeClass,
                  )}
                >
                  {t(mode.badgeKey)}
                </Badge>
              )}
              {isSelected && (
                <CheckCircle2 className="ml-auto size-4 shrink-0 fill-orange-500 text-white dark:text-orange-500" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
