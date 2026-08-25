// webui/src/components/shared/SplashScreen.tsx
// 入场加载屏（阶段 2）：React 挂载后接管 index.html 的 #moss-boot 骨架，视觉完全一致。
//   - 纯 CSS 动画：字样右侧三颗圆点依次跳动（波浪式 stagger）
//   - 真实进度引擎：里程碑 target（只增不减）来自真实加载信号，
//     display 经 rAF 平滑追赶——不虚报、不卡 99%、不突窜 100%
//   - 每浏览器会话只完整展示一次（sessionStorage 哨兵）
//   - 尊重动画总开关与系统"减弱动态效果"

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store';
import { wsClient } from '../../api/ws';
import { cn } from '../../lib/utils';

/** 会话哨兵 key：存在即本会话已展示过 */
const SPLASH_SESSION_KEY = 'moss-splash-shown';
/** 最短展示时长：保证入场段完整（ms） */
const MIN_DISPLAY_MS = 1600;
/** 兜底放行：后端未启动时不卡死（ms） */
const FALLBACK_MS = 4000;
/** 淡出时长（ms），与 CSS transition duration 保持一致 */
const EXIT_MS = 600;

// 进度里程碑 target 值
const T_MOUNT = 40; // splash 挂载（store 已 hydrate）
const T_CONFIG = 65; // 配置加载完成（appConfig 就绪）
const T_WS = 85; // WS 连接建立
const T_READY = 100; // 预载资源就绪（@ 菜单数据）或兜底放行

export function SplashScreen() {
  const { t } = useTranslation();
  const animationSettings = useStore((s) => s.animationSettings);

  // 渲染期同步判断（首帧即正确）：会话内已展示 / 动画总关 / 系统减弱动态 → 不展示
  const shouldShow = useMemo(() => {
    try {
      if (sessionStorage.getItem(SPLASH_SESSION_KEY) === '1') return false;
    } catch {
      // sessionStorage 不可用：照常展示（无哨兵，宁可多显示一次）
    }
    if (!animationSettings.enabled) return false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animationSettings.enabled]);

  const [pct, setPct] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [done, setDone] = useState(false);
  const targetRef = useRef(T_MOUNT);
  const displayRef = useRef(0);
  const mountedAtRef = useRef(0);
  const exitingRef = useRef(false);

  // 会话哨兵写入 + 挂载时间戳
  useEffect(() => {
    if (!shouldShow) return;
    try {
      sessionStorage.setItem(SPLASH_SESSION_KEY, '1');
    } catch {
      // 忽略：哨兵写失败不影响本次展示
    }
    mountedAtRef.current = Date.now();
  }, [shouldShow]);

  // 里程碑订阅：真实加载信号 → target（只增不减）
  useEffect(() => {
    if (!shouldShow) return;
    const bump = (v: number) => {
      if (v > targetRef.current) targetRef.current = v;
    };
    const checkState = (s: ReturnType<typeof useStore.getState>) => {
      if (s.appConfig !== null) bump(T_CONFIG);
      if (
        s.tools.length > 0 ||
        s.skills.length > 0 ||
        s.agents.length > 0 ||
        s.commands.length > 0
      ) {
        bump(T_READY);
      }
    };
    // 挂载时信号可能已就绪（如 splash 晚于某个 hook 完成加载）
    checkState(useStore.getState());
    const unsubStore = useStore.subscribe(checkState);
    const unsubWs = wsClient.onStatus((status) => {
      if (status === 'open') bump(T_WS);
    });
    // 兜底：后端未启动时强制放行，避免启动被阻塞
    const fallback = window.setTimeout(() => bump(T_READY), FALLBACK_MS);
    return () => {
      unsubStore();
      unsubWs();
      window.clearTimeout(fallback);
    };
  }, [shouldShow]);

  // rAF 追赶循环：display 平滑逼近 target，永不反超
  useEffect(() => {
    if (!shouldShow) return;
    let raf = 0;
    const tick = () => {
      const target = targetRef.current;
      if (displayRef.current < target) {
        displayRef.current = Math.min(
          displayRef.current + (target - displayRef.current) * 0.06 + 0.15,
          target,
        );
        setPct(Math.floor(displayRef.current));
      }
      // 退出条件：目标已到 100 + 显示追平 + 满足最短展示时长
      if (
        !exitingRef.current &&
        targetRef.current >= T_READY &&
        displayRef.current >= 99.6 &&
        Date.now() - mountedAtRef.current >= MIN_DISPLAY_MS
      ) {
        exitingRef.current = true;
        setExiting(true);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shouldShow]);

  // 淡出结束后卸载
  useEffect(() => {
    if (!exiting) return;
    const timer = window.setTimeout(() => setDone(true), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [exiting]);

  if (!shouldShow || done) return null;

  // 阶段文案按当前显示进度推导
  const phaseKey =
    pct < T_MOUNT
      ? 'splash.loading'
      : pct < T_CONFIG
        ? 'splash.config'
        : pct < T_WS
          ? 'splash.connect'
          : 'splash.ready';

  return (
    <div
      className={cn(
        'fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background font-sans',
        'transition-opacity duration-[600ms] ease-out',
        exiting && 'opacity-0',
      )}
      aria-label="MOSS"
    >
      <style>{`
        @keyframes moss-splash-dot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.45; }
          30% { transform: translateY(-6px); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .moss-splash-dot { animation: none !important; opacity: 0.7; }
        }
      `}</style>
      {/* 全部使用 px 单位：root font-size 在 App 挂载后由 16px（浏览器默认）变为 14px，
          rem 单位会导致 splash 内容中途集体缩小（“猛烈缩放”bug 根源） */}
      <img src="/MOSS.png" alt="MOSS" width={80} height={80} className="select-none" draggable={false} />
      <div className="mt-[24px] flex items-center gap-[8px]" aria-hidden>
        <span
          className="text-[26px] font-semibold tracking-[0.3em] text-foreground"
          style={{ marginRight: '-0.3em' }}
        >
          MOSS
        </span>
        {[0, 0.15, 0.3].map((delay) => (
          <span
            key={delay}
            className="moss-splash-dot inline-block h-[5px] w-[5px] rounded-full bg-primary"
            style={{ animation: `moss-splash-dot 1.2s ease-in-out ${delay}s infinite` }}
          />
        ))}
      </div>
      <div className="mt-[20px] text-[13px] tabular-nums text-muted-foreground">
        {t(phaseKey)} · {pct}%
      </div>
    </div>
  );
}
