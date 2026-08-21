// UI/src/hooks/useAutoScroll.ts
// 聊天滚动跟随状态机 hook：为 TaskPage 提供「发送后自动滚底 + 流式跟随 + 用户上滑即时脱离」能力。
//
// 核心设计（不对称状态机，防误判）：
// - pinnedRef 表示「底部跟随模式」。wheel 向上 / touchmove 手指下移 → 即时置 false（不等 scroll 事件），
//   保证流式高频追加时用户一旦开始上滑就绝不会被程序拉回（解决「模型回答时滑不动」）。
// - 程序滚底（instant/smooth）只会让 scrollTop 单调增大，因此「scrollTop 明显减小 → 脱离跟随」
//   的方向检测在任何时刻都安全；而 atBottom 显隐与恢复跟随仅在非程序窗口期更新，
//   防止程序滚动中间态导致按钮闪烁/状态自锁。
// - 程序滚动窗口期：doScrollToBottom 时开启，由 scrollend 或 200ms 超时关闭，窗口内不更新 atBottom。
// - 所有监听 passive + rAF 节流，setState 仅在布尔翻转时发生，杜绝高频重渲染与布局抖动。

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** 距底阈值（px）：按钮显隐与恢复跟随共用，避免「按钮已显示但仍在跟随」的闪烁歧义 */
const BOTTOM_EPSILON = 100;
/** scrollTop 减小超过该值才判定为用户向上滚动（抗 iOS 橡皮筋 / 亚像素抖动） */
const USER_SCROLL_UP_DELTA = 2;
/** 触摸上翻意图位移阈值（px）：手指下移超过该值视为查看历史 */
const TOUCH_UP_THRESHOLD = 4;
/** 程序滚动窗口期兜底时长（ms）：旧浏览器无 scrollend 时靠它关闭 */
const PROGRAMMATIC_WINDOW_MS = 200;
/** 平滑滚动的程序窗口兜底时长（ms）：smooth 动画持续约 500ms+，窗口过短会中途误报 atBottom（按钮闪烁） */
const SMOOTH_WINDOW_MS = 1000;

export interface UseAutoScrollOptions {
  /** 会话切换 key（变化时重置内部状态，下一轮 scrollDeps 触发首次强滚底） */
  resetKey: string | undefined;
  /** 触发滚底检查的依赖（消息数 / 最后消息长度 / 生成中），数组长度必须恒定 */
  scrollDeps: readonly unknown[];
}

export interface UseAutoScrollReturn {
  /** 是否处于底部（驱动「返回底部」按钮显隐与跑马灯） */
  atBottom: boolean;
  /** 仅恢复跟随标志（发送消息时用；滚底由 scrollDeps effect 兜底） */
  pin: () => void;
  /** 当前是否处于底部跟随模式（读 ref，不引起重渲染）；发送消息时仅在跟随态才自动滚底 */
  isPinned: () => boolean;
  /** 滚到底部并恢复跟随（「返回底部」按钮用） */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

export function useAutoScroll(
  scrollRef: RefObject<HTMLDivElement | null>,
  options: UseAutoScrollOptions,
): UseAutoScrollReturn {
  const { resetKey, scrollDeps } = options;
  const [atBottom, setAtBottom] = useState(true);
  /** 底部跟随模式 */
  const pinnedRef = useRef(true);
  /** 会话内是否已执行首次强滚底（历史加载完成后定位最新消息） */
  const hasAutoScrolledRef = useRef(false);
  /** 程序滚动窗口期标志：窗口内 scroll 事件不更新 atBottom 显隐 */
  const programmaticRef = useRef(false);
  /** 上一次 scrollTop（方向检测基准）；-1 表示尚无基准 */
  const lastScrollTopRef = useRef(-1);
  /** 程序窗口兜底定时器句柄 */
  const programmaticTimerRef = useRef<number | null>(null);
  /** scroll / resize 校准的 rAF 句柄 */
  const measureRafRef = useRef<number | null>(null);
  /** 滚底后二次校正 rAF 句柄（Markdown 高亮 / 图片等异步高度变化） */
  const correctRafRef = useRef<number | null>(null);
  /** touchmove 起点 Y */
  const touchStartYRef = useRef(0);

  /** 读取一次滚动几何并推进状态机（读写分离：一次读、一次写，不做 layout thrashing） */
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = lastScrollTopRef.current;
    const { scrollTop, scrollHeight, clientHeight } = el;
    lastScrollTopRef.current = scrollTop;
    // 方向检测：程序滚底只会增大 scrollTop，任何明显减小都来自用户（拖滚动条/键盘）或罕见的内容塌陷，
    // 即时脱离跟随——该检测不受程序窗口期限制，否则流式期间用户拖滚动条会被反复拉回。
    if (prev >= 0 && scrollTop < prev - USER_SCROLL_UP_DELTA) {
      pinnedRef.current = false;
    }
    if (programmaticRef.current) return; // 窗口期：不更新 atBottom（防滚动中间态闪烁），窗口关闭后校准
    const isAtBottom = scrollHeight - scrollTop - clientHeight < BOTTOM_EPSILON;
    setAtBottom((p) => (p === isAtBottom ? p : isAtBottom));
    if (isAtBottom) {
      pinnedRef.current = true; // 用户滚回底部 → 恢复跟随
    }
  }, [scrollRef]);

  /** 关闭程序窗口并校准最终状态 */
  const endProgrammatic = useCallback(() => {
    if (programmaticTimerRef.current !== null) {
      clearTimeout(programmaticTimerRef.current);
      programmaticTimerRef.current = null;
    }
    if (!programmaticRef.current) return;
    programmaticRef.current = false;
    measure();
  }, [measure]);

  /** 开启程序滚动窗口（scrollend 优先关闭，超时兜底：auto 200ms / smooth 1000ms） */
  const openProgrammaticWindow = useCallback(
    (behavior: ScrollBehavior) => {
      programmaticRef.current = true;
      if (programmaticTimerRef.current !== null) clearTimeout(programmaticTimerRef.current);
      programmaticTimerRef.current = window.setTimeout(
        () => {
          programmaticTimerRef.current = null;
          endProgrammatic();
        },
        behavior === 'smooth' ? SMOOTH_WINDOW_MS : PROGRAMMATIC_WINDOW_MS,
      );
    },
    [endProgrammatic],
  );

  /** 程序滚底：恢复跟随 + 开窗口 + 乐观置 atBottom + rAF 二次校正异步高度变化 */
  const doScrollToBottom = useCallback(
    (behavior: ScrollBehavior) => {
      const el = scrollRef.current;
      if (!el) return;
      pinnedRef.current = true;
      openProgrammaticWindow(behavior);
      el.scrollTo({ top: el.scrollHeight, behavior });
      setAtBottom(true);
      // 二次校正仅用于 instant 路径（流式高频追加后的异步高度变化兜底）；
      // smooth 下执行瞬时 scrollTo 会立刻截断平滑动画
      if (behavior === 'smooth') return;
      if (correctRafRef.current !== null) cancelAnimationFrame(correctRafRef.current);
      correctRafRef.current = requestAnimationFrame(() => {
        correctRafRef.current = null;
        const el2 = scrollRef.current;
        if (el2 && pinnedRef.current) el2.scrollTo({ top: el2.scrollHeight }); // instant 校正
      });
    },
    [scrollRef, openProgrammaticWindow],
  );

  /** rAF 节流的校准调度（scroll 与 ResizeObserver 共用） */
  const scheduleMeasure = useCallback(() => {
    if (measureRafRef.current !== null) return;
    measureRafRef.current = requestAnimationFrame(() => {
      measureRafRef.current = null;
      measure();
    });
  }, [measure]);

  // 事件绑定：scroll / scrollend / wheel / touch（全部 passive），随组件生命周期绑定与清理。
  // resetKey 变化不重新绑定（滚动容器为同一 DOM 元素），状态重置由下方 reset effect 负责。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => scheduleMeasure();
    const onScrollEnd = () => endProgrammatic();
    const onWheel = (e: WheelEvent) => {
      // 向上滚动（查看历史）→ 即时脱离跟随，不等 scroll 事件，保证流式期间「滑得动」
      if (e.deltaY < 0) pinnedRef.current = false;
    };
    const onTouchStart = (e: TouchEvent) => {
      touchStartYRef.current = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      // 手指下移（clientY 增大）= 内容上滚 = 查看历史 → 即时脱离跟随
      if (y !== undefined && y > touchStartYRef.current + TOUCH_UP_THRESHOLD) {
        pinnedRef.current = false;
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('scrollend', onScrollEnd);
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });

    // 容器尺寸变化（窗口 resize / 右侧面板开合引起的重排）→ rAF 校准 atBottom
    const ro = new ResizeObserver(() => scheduleMeasure());
    ro.observe(el);

    return () => {
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('scrollend', onScrollEnd);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      ro.disconnect();
      if (measureRafRef.current !== null) {
        cancelAnimationFrame(measureRafRef.current);
        measureRafRef.current = null;
      }
      if (correctRafRef.current !== null) {
        cancelAnimationFrame(correctRafRef.current);
        correctRafRef.current = null;
      }
      if (programmaticTimerRef.current !== null) {
        clearTimeout(programmaticTimerRef.current);
        programmaticTimerRef.current = null;
      }
      programmaticRef.current = false;
    };
  }, [scrollRef, scheduleMeasure, endProgrammatic]);

  // 会话切换：重置全部内部状态；若 store 已有该会话缓存消息则立即滚底（历史异步加载后由 scrollDeps 兜底）。
  // 同时清除残留的程序窗口定时器，防止旧会话的窗口串扰新会话的判定。
  useEffect(() => {
    pinnedRef.current = true;
    hasAutoScrolledRef.current = false;
    lastScrollTopRef.current = -1;
    programmaticRef.current = false;
    if (programmaticTimerRef.current !== null) {
      clearTimeout(programmaticTimerRef.current);
      programmaticTimerRef.current = null;
    }
    setAtBottom(true);
    const el = scrollRef.current;
    if (el && el.scrollHeight > el.clientHeight) {
      doScrollToBottom('auto');
    }
  }, [resetKey, scrollRef, doScrollToBottom]);

  // 滚底驱动：首次强滚底；此后仅 pinned（跟随模式）时滚底，用户看历史时绝不打扰。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!hasAutoScrolledRef.current) {
      doScrollToBottom('auto');
      hasAutoScrolledRef.current = true;
      return;
    }
    if (pinnedRef.current) {
      // 流式跟随必须 instant：smooth 在高频追加下永远追不上，且会持续产生中间态 scroll 事件
      doScrollToBottom('auto');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...scrollDeps]);

  /** 仅恢复跟随标志（滚底由 scrollDeps effect 兜底） */
  const pin = useCallback(() => {
    pinnedRef.current = true;
  }, []);

  /** 读当前跟随模式（ref 读取，零渲染开销） */
  const isPinned = useCallback(() => pinnedRef.current, []);

  /** 滚到底部并恢复跟随（浏览器原生 smooth 为固定时长自适应速度，长距离也只是滚得快，不降级） */
  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      if (!scrollRef.current) return;
      doScrollToBottom(behavior);
    },
    [scrollRef, doScrollToBottom],
  );

  return { atBottom, pin, isPinned, scrollToBottom };
}
