// webui/src/lib/icons.ts
// 全量 lucide 图标注册表：kebab-case 名称 ↔ LucideIcon 组件映射。
// 注意：`icons` 全量导入会打包全部图标（约 1700+，bundle 相应增大），
// 仅允许此文件直接导入 `icons`，其余组件统一通过 getLucideIcon/ALL_ICON_NAMES 复用。
// 存储格式：lucide 官方 kebab-case 风格（如 'calendar-clock'）；
// 转换与官方命名在纯字母场景一致（数字段保持连续，如 ArrowUp01 ↔ 'arrow-up01'，
// 与 IconPicker 选择值自洽，不影响按名渲染）。

import { icons } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** PascalCase → kebab-case（'CalendarClock' → 'calendar-clock'） */
export function pascalToKebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** kebab-case → PascalCase（'calendar-clock' → 'CalendarClock'） */
export function kebabToPascal(name: string): string {
  return name
    .split('-')
    .map((seg) => (seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : seg))
    .join('');
}

/** PascalCase 名 → LucideIcon 组件映射 */
const iconByPascal = new Map<string, LucideIcon>(Object.entries(icons));

/** 全部可用图标名（kebab-case，已排序） */
export const ALL_ICON_NAMES: string[] = Object.keys(icons)
  .map(pascalToKebab)
  .sort();

/** kebab-case 名 → LucideIcon 的解析缓存 */
const resolvedCache = new Map<string, LucideIcon>();

/** 按 kebab-case 图标名解析 LucideIcon 组件；未找到返回 undefined（调用方自行回退） */
export function getLucideIcon(name: string): LucideIcon | undefined {
  const cached = resolvedCache.get(name);
  if (cached) return cached;
  const icon = iconByPascal.get(kebabToPascal(name));
  if (icon) resolvedCache.set(name, icon);
  return icon;
}
