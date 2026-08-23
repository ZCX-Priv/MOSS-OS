// 模型配置共享工具：弹窗（SettingsPage）与模型选择器（ModelSelector）共用

import type { ProviderModelItem, ThinkingLevelItem } from '../types/api';

/** 思考强度档位（弹窗与选择器共用） */
export type EffortLevel = 'off' | 'low' | 'medium' | 'high' | 'custom';

/**
 * 默认思考强度等级库（provider.thinkingLevels 未定义时生效；与后端 DEFAULT_THINKING_LEVELS 一致）。
 * 有序：位置越靠后档位越高；effort==='off' 选中时表示关闭思考。
 */
export const DEFAULT_LEVELS: ThinkingLevelItem[] = [
  { id: 'off', label: 'Off', effort: 'off' },
  { id: 'low', label: 'Low', effort: 'low' },
  { id: 'medium', label: 'Medium', effort: 'medium' },
  { id: 'high', label: 'High', effort: 'high' },
];

/** 生成思考等级 id：level_{timestamp}_{random}（自定义档用） */
export function generateLevelId(): string {
  return `level_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 旧 contextWindow 档位（'200k'/'1m'/'128000'）→ token 数。
 * 与后端 parseContextWindow 同规则；非法/缺失返回 undefined。
 */
export function parseLegacyWindow(cw?: string): number | undefined {
  if (!cw) return undefined;
  const raw = cw.trim().toLowerCase();
  const m = /^(\d+(?:\.\d+)?)([km]?)$/.exec(raw);
  if (!m) {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  const mult = m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1;
  const tokens = Math.round(Number.parseFloat(m[1]) * mult);
  return tokens > 0 ? tokens : undefined;
}

/** 模型 thinking 配置 → 思考强度档位（预设档 off/low/medium/high，其余归 custom） */
export function toEffortLevel(thinking?: ProviderModelItem['thinking']): EffortLevel {
  if (!thinking?.enabled) return 'off';
  const e = thinking.effort;
  if (e === 'low' || e === 'medium' || e === 'high') return e;
  return 'custom';
}
