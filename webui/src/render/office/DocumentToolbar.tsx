// render/office/DocumentToolbar.tsx
// 文档类预览的通用工具栏（编辑器样式）：缩放 −/+/百分比 + 适应宽度 + 页码导航 + 旋转 + 单页/连续切换。
// 纯展示组件：所有能力按需传入（未传的回调则不渲染对应按钮），各渲染器复用以保证交互一致。
// 只在自持容器内渲染，不向 document.body 挂载任何节点。

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Columns2, Maximize2, Minus, Plus, RotateCw, Rows2 } from 'lucide-react';
import { Button } from '../../components/ui/button';

export interface DocumentToolbarProps {
  /** 当前缩放（1 = 100%） */
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** 点击百分比文字时重置到 100% */
  onZoomReset?: () => void;
  /** 适应宽度 */
  onFitWidth?: () => void;
  /** 当前页码（从 1 开始） */
  page?: number;
  pageCount?: number;
  onPageChange?: (page: number) => void;
  /** 单页 / 连续滚动切换（仅两者都传入时显示） */
  continuous?: boolean;
  onToggleContinuous?: () => void;
  onRotate?: () => void;
  /** 右侧附加内容（如工作表标签、截断提示） */
  extra?: ReactNode;
}

const ICON_BTN = 'h-7 w-7 p-0';

export function DocumentToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFitWidth,
  page,
  pageCount,
  onPageChange,
  continuous,
  onToggleContinuous,
  onRotate,
  extra,
}: DocumentToolbarProps) {
  const { t } = useTranslation();
  const showPager = page !== undefined && pageCount !== undefined && onPageChange !== undefined;

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        {showPager && (
          <>
            <Button
              variant="outline"
              size="sm"
              className={ICON_BTN}
              disabled={(page ?? 1) <= 1}
              onClick={() => onPageChange?.(Math.max(1, (page ?? 1) - 1))}
              aria-label={t('preview.pagePrev')}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <input
              type="number"
              min={1}
              max={pageCount}
              value={page}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) onPageChange?.(Math.min(pageCount ?? 1, Math.max(1, Math.round(n))));
              }}
              className="h-7 w-12 rounded border border-border bg-background px-1 text-center font-mono text-xs text-foreground"
              aria-label={t('preview.pageNumber')}
            />
            <span className="font-mono text-xs text-muted-foreground">/ {pageCount}</span>
            <Button
              variant="outline"
              size="sm"
              className={ICON_BTN}
              disabled={(page ?? 1) >= (pageCount ?? 1)}
              onClick={() => onPageChange?.(Math.min(pageCount ?? 1, (page ?? 1) + 1))}
              aria-label={t('preview.pageNext')}
            >
              <ChevronRight className="size-4" />
            </Button>
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {onToggleContinuous && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onToggleContinuous}
            title={continuous ? t('preview.modeSingle') : t('preview.modeContinuous')}
          >
            {continuous ? <Rows2 className="size-3.5" /> : <Columns2 className="size-3.5" />}
            <span className="ml-1">{continuous ? t('preview.modeContinuous') : t('preview.modeSingle')}</span>
          </Button>
        )}
        {onRotate && (
          <Button variant="outline" size="sm" className={ICON_BTN} onClick={onRotate} aria-label={t('preview.rotate')}>
            <RotateCw className="size-3.5" />
          </Button>
        )}
        {onFitWidth && (
          <Button variant="outline" size="sm" className={ICON_BTN} onClick={onFitWidth} aria-label={t('preview.fitWidth')}>
            <Maximize2 className="size-3.5" />
          </Button>
        )}
        <Button variant="outline" size="sm" className={ICON_BTN} onClick={onZoomOut} aria-label={t('preview.zoomOut')}>
          <Minus className="size-3.5" />
        </Button>
        <button
          type="button"
          onClick={onZoomReset}
          className="min-w-11 text-center font-mono text-xs tabular-nums text-muted-foreground hover:text-foreground"
          title={onZoomReset ? t('preview.zoomReset') : undefined}
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button variant="outline" size="sm" className={ICON_BTN} onClick={onZoomIn} aria-label={t('preview.zoomIn')}>
          <Plus className="size-3.5" />
        </Button>
        {extra}
      </div>
    </div>
  );
}