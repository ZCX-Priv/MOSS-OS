// UI/src/components/shared/ScrollToBottomButton.tsx
// 「返回底部」悬浮按钮：定位由调用方容器决定（absolute bottom-3 left-1/2 -translate-x-1/2）。
// - 桌面端：文字「返回底部」+ 向下箭头；移动端（<768px）：仅箭头（纯 CSS 响应式，零状态开销）。
// - streaming 时边缘跑马灯淡入：实测像素尺寸的 SVG rect(rx=半高) 1:1 贴合胶囊边缘，
//   pathLength=100 归一化周长 + dashoffset 线性动画 ⇒ 光弧沿边缘匀速奔跑
//   （conic-gradient 角速度恒定方案在直线段中部会视觉减速，已弃用）。
// - 跑马灯随 streaming 淡入淡出（.is-on opacity 过渡，见 global.css）；
//   按钮显隐用 opacity + translate 过渡，隐藏时 pointer-events-none，不拦截消息区交互。

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/** 跑马灯 SVG 外扩边距（描边与辉光不被裁切），与 global.css .marquee-ring 的 inset 保持一致 */
const RING_PAD = 6;

interface ScrollToBottomButtonProps {
  /** 是否显示（= 不在底部） */
  visible: boolean;
  /** 是否流式生成中（跑马灯点亮条件） */
  streaming: boolean;
  onClick: () => void;
}

export function ScrollToBottomButton({ visible, streaming, onClick }: ScrollToBottomButtonProps) {
  const { t } = useTranslation();
  const pillRef = useRef<HTMLSpanElement>(null);
  const [pillSize, setPillSize] = useState<{ w: number; h: number } | null>(null);

  // 测量药丸实际像素尺寸：跑马灯 rect 需 1:1 像素贴合，
  // 任何拉伸映射都会让弧长动画在视觉上重新变成变速
  useEffect(() => {
    const el = pillRef.current;
    if (!el) return;
    const measure = () => setPillSize({ w: el.offsetWidth, h: el.offsetHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

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
      <span
        ref={pillRef}
        className="relative flex items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-1.5 shadow-md backdrop-blur"
      >
        {/* 跑马灯环：rect 周长归一化为 100，dashoffset 0→-100 恰好匀速跑一整圈；
            常驻挂载，streaming && visible 时 .is-on 淡入，否则淡出（见 global.css） */}
        {pillSize && (
          <svg
            className={cn('marquee-ring', streaming && visible && 'is-on')}
            viewBox={`0 0 ${pillSize.w + RING_PAD * 2} ${pillSize.h + RING_PAD * 2}`}
            aria-hidden="true"
          >
            <rect
              x={RING_PAD}
              y={RING_PAD}
              width={pillSize.w}
              height={pillSize.h}
              rx={pillSize.h / 2}
              fill="none"
              pathLength={100}
              className="marquee-run"
            />
          </svg>
        )}
        <ChevronDown className="size-4" />
        <span className="hidden text-xs font-medium md:inline">{t('task.backToBottom')}</span>
      </span>
    </button>
  );
}
