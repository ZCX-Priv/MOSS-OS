// 通用中控岛：任务输入框上方的模块化控制容器。
// 折叠态 = 一行状态区 + 模块 chips（badge 徽标提醒）；点击 chip 展开模块内容面板。
// 背景透明（不遮挡后方），保留边框轮廓。

import { useEffect, useState, type ReactNode } from 'react';
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
  // 收起后仍保持最后激活模块渲染：高度 0fr→1fr 过渡需要内容在场（卸载则无过渡可言）
  const [lastModuleId, setLastModuleId] = useState<string | null>(null);
  useEffect(() => {
    if (activeModuleId) setLastModuleId(activeModuleId);
  }, [activeModuleId]);
  const activeModule = modules.find((m) => m.id === activeModuleId);
  const expanded = !!activeModule;
  const panelModule = modules.find((m) => m.id === (activeModuleId ?? lastModuleId));

  return (
    <div
      className={cn(
        'mx-auto w-[96%] rounded-xl border border-border bg-transparent transition-shadow',
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
                    ? 'border-primary-strong/50 bg-primary-strong/10 text-primary-strong'
                    : hasBadge
                      ? 'border-primary-strong/40 bg-primary-strong/5 text-foreground hover:bg-primary-strong/10'
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
      {/* 高度过渡容器：grid 0fr↔1fr（高度动画到 auto 的标准方案）+ opacity + visibility 离散过渡
          （收起动画播完才隐藏、展开立即显示；invisible 防收起后内部聚焦/命中） */}
      <div
        className={cn(
          'anim-hub grid transition-[grid-template-rows,opacity,visibility] duration-200 ease-out',
          expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 invisible',
        )}
      >
        <div className="overflow-hidden">
          {/* 模块切换（A→B）时 key 变化 remount 轻淡入；border-t 放内容层随裁切（放 grid 容器上收起时 1px 边线仍可见） */}
          <div
            key={panelModule?.id}
            className="animate-in fade-in duration-200 border-t border-border p-2.5"
          >
            {panelModule?.render()}
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
        </div>
      </div>
    </div>
  );
}
