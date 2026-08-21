// UI/src/components/shared/ScrollToBottomButton.tsx
// 「返回底部」悬浮按钮：定位由调用方容器决定（absolute bottom-3 left-1/2 -translate-x-1/2）。
// - 桌面端：文字「返回底部」+ 向下箭头；移动端（<768px）：仅箭头（纯 CSS 响应式，零状态开销）。
// - streaming && visible 时边缘出现追逐式跑马灯（.marquee-border 贴边光环，见 global.css）。
// - 显隐用 opacity + translate 过渡，隐藏时 pointer-events-none，不拦截消息区交互。

import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ScrollToBottomButtonProps {
  /** 是否显示（= 不在底部） */
  visible: boolean;
  /** 是否流式生成中（跑马灯条件之一） */
  streaming: boolean;
  onClick: () => void;
}

export function ScrollToBottomButton({ visible, streaming, onClick }: ScrollToBottomButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-label={t('task.backToBottom')}
      title={t('task.backToBottom')}
      onClick={onClick}
      className={cn(
        'absolute bottom-3 left-1/2 z-10 -translate-x-1/2',
        'transition-[opacity,translate] duration-200',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
      )}
    >
      {/* 跑马灯：.marquee-border 的 ::before 光环经 mask 只露出边缘一圈，
          border-radius: inherit 保证精确贴合胶囊边缘（见 global.css） */}
      <span
        className={cn(
          'relative flex items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-1.5 shadow-md backdrop-blur',
          streaming && visible && 'marquee-border',
        )}
      >
        <ChevronDown className="size-4" />
        <span className="hidden text-xs font-medium md:inline">{t('task.backToBottom')}</span>
      </span>
    </button>
  );
}
