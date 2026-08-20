// UI/src/hooks/useAnimationClass.ts
// 动画开关 → <html> class 桥接：
//   总关（用户关闭总开关 或 系统开启"减弱动态效果"）→ anim-off
//   分关 → anim-route-off / anim-msg-off / anim-list-off / anim-stat-off / anim-hub-off
// prefers-reduced-motion 实时监听（matchMedia change），随时变更立即生效并同步 store
// （设置页开关禁用态依赖 store.prefersReducedMotion）。

import { useEffect } from 'react';
import { useStore } from '../store';

/** 系统是否开启"减弱动态效果"（实时；设置页据此禁用动画开关） */
export function useReducedMotion(): boolean {
  return useStore((s) => s.prefersReducedMotion);
}

const CATEGORY_CLASSES = {
  route: 'anim-route-off',
  message: 'anim-msg-off',
  list: 'anim-list-off',
  stat: 'anim-stat-off',
  hub: 'anim-hub-off',
  panel: 'anim-panel-off',
} as const;

/** 全局挂载一次：监听动画设置与系统减弱动态偏好，维护 <html> 上的动画禁用 class */
export function useAnimationClass(): void {
  const animationSettings = useStore((s) => s.animationSettings);
  const prefersReducedMotion = useStore((s) => s.prefersReducedMotion);
  const setPrefersReducedMotion = useStore((s) => s.setPrefersReducedMotion);

  // 系统偏好实时监听（挂载时读取 + change 事件同步 store）
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPrefersReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [setPrefersReducedMotion]);

  // 开关状态 → html class
  useEffect(() => {
    const el = document.documentElement;
    const classes = new Set(el.classList);
    const remove = (c: string) => { classes.delete(c); el.classList.remove(c); };
    const add = (c: string) => { classes.add(c); el.classList.add(c); };

    // 总开关：用户关闭 或 系统减弱动态 → 全部停用
    const masterOff = !animationSettings.enabled || prefersReducedMotion;
    if (masterOff) add('anim-off');
    else remove('anim-off');

    for (const [key, cls] of Object.entries(CATEGORY_CLASSES)) {
      const off = masterOff || !animationSettings[key as keyof typeof animationSettings];
      if (off) add(cls);
      else remove(cls);
    }
  }, [animationSettings, prefersReducedMotion]);
}
