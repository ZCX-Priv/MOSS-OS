import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export interface UseResizableOptions {
  /** 手柄所在侧：'right'=面板在左、手柄在右（如左侧 sidebar）；'left'=面板在右、手柄在左（如右侧 aside） */
  side: 'left' | 'right';
  min?: number;
  max?: number;
  onChange: (width: number) => void;
}

/**
 * 通用面板拖拽调宽 hook。
 * 核心用 Pointer Capture 锁定指针事件，保证拖拽过程中 pointermove/pointerup 始终派发到手柄，
 * 即使指针移出窗口也不会丢失，从而彻底避免"拖拽状态无法解除"。
 */
export function useResizable({ side, min = 240, max = 480, onChange }: UseResizableOptions) {
  const [resizing, setResizing] = useState(false);
  const anchor = useRef({ x: 0, width: 0 }); // 拖拽起始点与起始宽度

  const clamp = useCallback((w: number) => Math.min(max, Math.max(min, w)), [min, max]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    // 关键：捕获指针，使后续 pointermove/up 始终派发到本元素（即使移出窗口）
    el.setPointerCapture?.(e.pointerId);
    // 起始宽度取手柄父容器（面板）当前实际宽度，保证准确
    anchor.current = {
      x: e.clientX,
      width: el.parentElement?.getBoundingClientRect().width ?? 0,
    };
    setResizing(true);
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!resizing) return;
      const delta = e.clientX - anchor.current.x;
      // side='right'（手柄在右）：向右拖变宽 => start + delta
      // side='left'（手柄在左）：向左拖变宽 => start - delta
      const next =
        side === 'right'
          ? anchor.current.width + delta
          : anchor.current.width - delta;
      onChange(clamp(next));
    },
    [resizing, side, onChange, clamp]
  );

  // 多退出路径（pointerup / pointercancel / capture 丢失），确保 resizing 一定复位
  const endResize = useCallback(() => setResizing(false), []);

  return {
    resizing,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endResize,
      onPointerCancel: endResize,
      onLostPointerCapture: endResize,
    },
  };
}