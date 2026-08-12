// UI/src/components/overlays/ModelSelector.tsx
// 模型选择器：
// - 桌面端：DropdownMenu 上拉菜单 + Popover 作为参数面板。
//   Popover 锚定齿轮按钮，点击打开，鼠标移开不关闭，点击外部/齿轮/Esc 才关闭。
//   子菜单左右自适应相对于整个上拉菜单（非齿轮按钮）。
// - 移动端：底部 Sheet 抽屉，齿轮展开内联设置。
// 自包含触发按钮，不再依赖外部 children。

import { useState, useRef, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, Plus, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useModels } from '../../hooks/useModels';
import { useIsMobile } from '../../hooks/use-mobile';
import type { ThinkingEffort, ModelItem } from '../../types/api';

/** 后端 effort → 前端档位：xhigh→max, high→high, 其余(含 undefined)→max */
function toUiLevel(effort?: ThinkingEffort): 'high' | 'max' {
  return effort === 'high' ? 'high' : 'max';
}

/** 前端档位 → 后端 effort：max→xhigh, high→high */
function toBackendEffort(level: 'high' | 'max'): ThinkingEffort {
  return level === 'max' ? 'xhigh' : 'high';
}

export function ModelSelector() {
  const { t } = useTranslation();
  const { models, currentModel, setCurrent, updateModel } = useModels();
  const isMobile = useIsMobile();
  const currentModelName = models.find((m) => m.id === currentModel)?.name;

  // 桌面端子菜单控制
  const [mainOpen, setMainOpen] = useState(false);
  const [openSubId, setOpenSubId] = useState<string | undefined>();
  const [subSide, setSubSide] = useState<'right' | 'left'>('right');
  const [subSideOffset, setSubSideOffset] = useState(4);
  const contentRef = useRef<HTMLDivElement>(null);

  // 移动端抽屉控制
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | undefined>();

  // 主菜单打开时测量内容宽度，计算子菜单应放左侧还是右侧（相对于整个菜单）
  useLayoutEffect(() => {
    if (!mainOpen) return;
    const measure = () => {
      const el = contentRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const rightSpace = window.innerWidth - rect.right;
      if (rightSpace < 256 + 8) {
        setSubSide('left');
        // 让子菜单右边缘对齐菜单左边缘 - 4px 间距
        setSubSideOffset(Math.round(rect.width) - 24 + 4);
      } else {
        setSubSide('right');
        setSubSideOffset(4);
      }
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
  }, [mainOpen]);

  /** 渲染模型参数设置区（桌面子菜单与移动端内联共用） */
  const renderSettings = (model: ModelItem) => {
    const thinking = model.thinking;
    const thinkingEnabled = thinking?.enabled ?? false;
    const uiLevel = toUiLevel(thinking?.effort);
    const ctx = model.contextWindow ?? '1m';
    return (
      <>
        {/* 上下文窗口 */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-foreground">
            {t('modelSelector.contextWindow')}
          </label>
          <ToggleGroup
            type="single"
            value={ctx}
            onValueChange={(v) =>
              v && void updateModel(model.id, { contextWindow: v })
            }
            variant="outline"
            className="w-full"
          >
            <ToggleGroupItem value="200k" className="flex-1">
              200K
            </ToggleGroupItem>
            <ToggleGroupItem value="400k" className="flex-1">
              400K
            </ToggleGroupItem>
            <ToggleGroupItem value="1m" className="flex-1">
              1M
            </ToggleGroupItem>
          </ToggleGroup>
          {ctx === '200k' && (
            <Badge variant="secondary" className="w-fit font-normal">
              {t('modelSelector.default')}
            </Badge>
          )}
        </div>

        {/* 思考模式 */}
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-foreground">
              {t('modelSelector.thinkingMode')}
            </label>
            <Switch
              checked={thinkingEnabled}
              onCheckedChange={(next) =>
                void updateModel(model.id, {
                  thinking: { ...thinking, enabled: next },
                })
              }
            />
          </div>
          <ToggleGroup
            type="single"
            value={uiLevel}
            onValueChange={(v) =>
              v &&
              void updateModel(model.id, {
                thinking: {
                  ...thinking,
                  effort: toBackendEffort(v as 'high' | 'max'),
                },
              })
            }
            variant="outline"
            disabled={!thinkingEnabled}
            className="w-full"
          >
            <ToggleGroupItem value="high" className="flex-1">
              high
            </ToggleGroupItem>
            <ToggleGroupItem value="max" className="flex-1 gap-1">
              max
              <Badge variant="secondary" className="font-normal">
                {t('modelSelector.default')}
              </Badge>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </>
    );
  };

  // ======================== 移动端：底部抽屉 ========================
  if (isMobile) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 rounded-full"
          onClick={() => setSheetOpen(true)}
        >
          <span>{currentModelName || 'Auto'}</span>
          <ChevronDown className="size-3 opacity-70" />
        </Button>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto p-4">
            <SheetHeader>
              <SheetTitle>{t('modelSelector.title')}</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-1 px-1 pb-2 pt-2">
              {models.length === 0 && (
                <div className="px-2 py-4 text-xs text-muted-foreground">
                  {t('modelSelector.noModels', { defaultValue: '暂无可用模型' })}
                </div>
              )}
              {models.map((model) => {
                const isSelected = currentModel === model.id;
                return (
                  <div key={model.id} className="flex flex-col">
                    <div
                      className={cn(
                        'flex items-center justify-between rounded-md px-2 py-1.5',
                        isSelected && 'bg-muted'
                      )}
                    >
                      <button
                        className="min-w-0 flex-1 truncate text-left text-sm"
                        onClick={() => {
                          void setCurrent(model.id);
                          setSheetOpen(false);
                        }}
                      >
                        {model.name}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0"
                        onClick={() =>
                          setExpandedId((p) =>
                            p === model.id ? undefined : model.id
                          )
                        }
                      >
                        <SlidersHorizontal className="size-3.5" />
                      </Button>
                    </div>
                    {expandedId === model.id && (
                      <div className="border-t px-1 py-3">
                        {renderSettings(model)}
                      </div>
                    )}
                  </div>
                );
              })}
              <DropdownMenuSeparator />
              <button className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-muted-foreground">
                <Plus className="size-3.5" />
                {t('modelSelector.addCustomModel')}
              </button>
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // ======================== 桌面端：DropdownMenu ========================
  return (
    <DropdownMenu
      modal={false}
      open={mainOpen}
      onOpenChange={(o) => {
        setMainOpen(o);
        if (!o) setOpenSubId(undefined);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 rounded-full">
          <span>{currentModelName || 'Auto'}</span>
          <ChevronDown className="size-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={contentRef}
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        onInteractOutside={(e) => {
          // 二级调参面板（独立 Portal）上的交互不应关闭主菜单
          const target = e.target as Node | null;
          if (
            target &&
            (target as HTMLElement).closest?.('[data-slot="popover-content"]')
          ) {
            e.preventDefault();
          }
        }}
        className="w-64 max-h-[min(14.625rem,var(--radix-dropdown-menu-content-available-height))] p-1"
      >
        {models.length === 0 && (
          <div className="px-2 py-4 text-xs text-muted-foreground">
            {t('modelSelector.noModels', { defaultValue: '暂无可用模型' })}
          </div>
        )}
        {models.map((model) => {
          const isSelected = currentModel === model.id;
          return (
            <DropdownMenuItem
              key={model.id}
              onSelect={(e) => {
                if (isSelected) {
                  // 已选中模型：再次点击切换参数面板（保持菜单打开）
                  e.preventDefault();
                  setOpenSubId((p) => (p === model.id ? undefined : model.id));
                } else {
                  void setCurrent(model.id);
                }
              }}
              className={cn('justify-between', isSelected && 'bg-muted text-foreground')}
            >
              <span className="truncate">{model.name}</span>
              {/* 齿轮触发参数面板：Popover 点击打开，鼠标移开不关闭 */}
              <Popover
                open={openSubId === model.id}
                onOpenChange={(o) =>
                  setOpenSubId(o ? model.id : undefined)
                }
              >
                <PopoverAnchor asChild>
                  <button
                    type="button"
                    className="ml-auto inline-flex size-6 items-center justify-center rounded-md hover:bg-accent"
                    onMouseDown={(e) => {
                      // 阻止 DropdownMenuItem 获得焦点/触发 onSelect
                      e.preventDefault();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpenSubId((p) =>
                        p === model.id ? undefined : model.id
                      );
                    }}
                  >
                    <SlidersHorizontal className="size-3.5" />
                  </button>
                </PopoverAnchor>
                <PopoverContent
                  side={subSide}
                  sideOffset={subSideOffset}
                  align={subSide === 'left' ? 'end' : 'start'}
                  collisionPadding={8}
                  className="w-64 p-3"
                  // 阻止点击面板内容时冒泡到 DropdownMenu 导致关闭
                  onMouseDown={(e) => e.preventDefault()}
                  // 鼠标在主菜单 item 间移动触发 item 聚焦 / pointerdown 时，
                  // 对 PopoverContent 而言是 outside，会触发子菜单自我关闭。
                  // 这里拦截来自主菜单的交互，保持子菜单打开。
                  onInteractOutside={(e) => {
                    const target = e.target as Node | null;
                    if (
                      target &&
                      ((target as HTMLElement).closest?.(
                        '[data-slot="dropdown-menu-content"]'
                      ) ||
                        (target as HTMLElement).closest?.(
                          '[data-slot="dropdown-menu-item"]'
                        ))
                    ) {
                      e.preventDefault();
                    }
                  }}
                >
                  {renderSettings(model)}
                </PopoverContent>
              </Popover>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-1.5 text-muted-foreground">
          <Plus className="size-3.5" />
          {t('modelSelector.addCustomModel')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
