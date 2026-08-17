// 通用中控岛：任务输入框上方的模块化控制容器。
// 折叠态 = 一行状态区 + 模块 chips（badge 徽标提醒）；点击 chip 展开模块内容面板。

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ControlHubModule {
  id: string;
  icon: LucideIcon;
  title: string;
  /** 徽标数字（>0 时 chip 高亮提示有待处理项） */
  badge?: number;
  /** 展开态的内容面板 */
  render: () => ReactNode;
}

interface ControlHubProps {
  /** 左侧状态区（运行状态指示，由调用方注入） */
  status?: ReactNode;
  modules: ControlHubModule[];
  /** 当前展开激活的模块 id；null/undefined = 折叠 */
  activeModuleId: string | null | undefined;
  onActiveModuleChange: (moduleId: string | null) => void;
}

export function ControlHub({ status, modules, activeModuleId, onActiveModuleChange }: ControlHubProps) {
  const { t } = useTranslation();
  const activeModule = modules.find((m) => m.id === activeModuleId);

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card/60 transition-shadow',
        activeModule && 'shadow-sm',
      )}
      data-expanded={activeModule ? 'true' : 'false'}
    >
      <div className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
        {status && <div className="flex min-w-0 shrink-0 items-center gap-1.5">{status}</div>}
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1">
          {modules.map((m) => {
            const Icon = m.icon;
            const isActive = m.id === activeModuleId;
            const hasBadge = (m.badge ?? 0) > 0;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onActiveModuleChange(isActive ? null : m.id)}
                title={m.title}
                aria-pressed={isActive}
                className={cn(
                  'inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
                  isActive
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : hasBadge
                      ? 'border-primary/40 bg-primary/5 text-foreground hover:bg-primary/10'
                      : 'border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="max-w-[10rem] truncate">{m.title}</span>
                {hasBadge && (
                  <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
                    {m.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {activeModule && (
        <div className="border-t border-border p-2.5">
          {activeModule.render()}
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              onClick={() => onActiveModuleChange(null)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronDown className="size-3" />
              {t('hub.collapse')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
