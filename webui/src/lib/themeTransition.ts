// 主题切换过渡：基于 View Transitions API 的圆形扩散揭示。
//
// 原理：startViewTransition 对新旧主题各截一张快照，过渡发生在合成器层
//（两层纹理混合，成本与 DOM 规模无关）。相比对所有元素强制 0.3s 颜色过渡
//（background/box-shadow/color 均为 paint 属性，无法 GPU 合成，大 DOM 掉帧）
// 更高效，且能对渐变背景平滑过渡。
//
// 视觉：新主题从 origin（点击处，缺省视口中心）以圆形 clip-path 扩散铺满全屏。
// 尊重系统"减弱动态效果"偏好：命中 reduce 时直接执行 applyTheme 瞬切。

/** 圆形扩散的原点（视口坐标） */
export interface ThemeTransitionOrigin {
  x: number;
  y: number;
}

/** 扩散动画时长：略长于常规 0.3s 过渡，让波纹轨迹可感知但不拖沓 */
const REVEAL_DURATION_MS = 500;

/**
 * 以圆形扩散过渡执行主题变更。
 * @param applyTheme 实际切换主题的回调（改 data-theme / store 状态），
 *                   必须在回调内完成变更，才能被捕获进"新主题"快照
 * @param origin 扩散原点，缺省为视口中心
 */
export function runThemeTransition(
  applyTheme: () => void,
  origin?: ThemeTransitionOrigin,
): void {
  if (
    typeof document === 'undefined' ||
    !document.startViewTransition ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    applyTheme();
    return;
  }

  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;
  // 终态半径 = 原点到视口最远角的距离，保证圆形恰好铺满整个视口
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  const transition = document.startViewTransition(applyTheme);
  transition.ready
    .then(() => {
      // 对"新主题"快照伪元素做 clip-path 圆形揭示；旧快照静止垫底
      //（默认交叉淡化已在 global.css 中关闭，动画由此处全权驱动）
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: REVEAL_DURATION_MS,
          easing: 'ease-in-out',
          pseudoElement: '::view-transition-new(root)',
        },
      );
    })
    // 连续快速切换时上一轮过渡被 skip，ready 会 reject，属正常流程
    .catch(() => {});
}