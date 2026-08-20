// UI/src/types/animation.ts
// 动画设置：总开关 + 每类动画分开关。
// 作用机制：useAnimationClass 把开关状态映射到 <html> class（anim-off / anim-<cat>-off），
// global.css 按类名禁用对应动画；prefers-reduced-motion 由系统设置实时覆盖（强制全关）。

export interface AnimationSettings {
  /** 总开关：关闭时停用全部动画（含分开关开启的类别） */
  enabled: boolean;
  /** 页面路由 / 设置分区切换入场 */
  route: boolean;
  /** 消息与消息流内卡片（确认/提问/工具卡等）入场 */
  message: boolean;
  /** 侧边栏任务/分组列表入场 */
  list: boolean;
  /** 数值与状态过渡（指标高亮脉冲等） */
  stat: boolean;
  /** 中控台模块面板展开/折叠与切换 */
  hub: boolean;
  /** 任务右侧边栏等面板的展开/收起过渡 */
  panel: boolean;
}

export const DEFAULT_ANIMATION_SETTINGS: AnimationSettings = {
  enabled: true,
  route: true,
  message: true,
  list: true,
  stat: true,
  hub: true,
  panel: true,
};

const ANIMATION_KEYS = ['enabled', 'route', 'message', 'list', 'stat', 'hub', 'panel'] as const;

/** 校验持久化数据：所有字段须为 boolean，任一缺失/类型不符视为非法（回退默认） */
export function isValidAnimationSettings(v: unknown): v is AnimationSettings {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return ANIMATION_KEYS.every((k) => typeof o[k] === 'boolean');
}
