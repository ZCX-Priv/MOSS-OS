// render/core/PreviewModeToggle.tsx
// 「预览 / 代码」胶囊（分段）切换：Markdown / LaTeX / HTML 等文本类预览器共用。
// 纯展示组件：受控 mode + onChange；文案走 i18n，图标 Eye / Code2。

import { useTranslation } from 'react-i18next';
import { Code2, Eye } from 'lucide-react';
import { cn } from '../../lib/utils';

export type PreviewMode = 'preview' | 'code';

export interface PreviewModeToggleProps {
  mode: PreviewMode;
  onChange: (mode: PreviewMode) => void;
}

const ITEM = 'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs transition-colors';
const ACTIVE = 'bg-background text-foreground shadow-sm';
const INACTIVE = 'text-muted-foreground hover:text-foreground';

export function PreviewModeToggle({ mode, onChange }: PreviewModeToggleProps) {
  const { t } = useTranslation();
  return (
    <div
      role="tablist"
      aria-label={t('preview.modePreview')}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-muted/40 p-0.5"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'preview'}
        onClick={() => onChange('preview')}
        className={cn(ITEM, mode === 'preview' ? ACTIVE : INACTIVE)}
      >
        <Eye className="size-3.5" />
        {t('preview.modePreview')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'code'}
        onClick={() => onChange('code')}
        className={cn(ITEM, mode === 'code' ? ACTIVE : INACTIVE)}
      >
        <Code2 className="size-3.5" />
        {t('preview.modeCode')}
      </button>
    </div>
  );
}
