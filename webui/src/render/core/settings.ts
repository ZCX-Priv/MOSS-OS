// render/core/settings.ts
// 渲染设置 hook：读全局 store 的 renderSettings 切片（store/index.ts 定义，IndexedDB 持久化）。

import { useStore } from '../../store';
import type { RenderSettings } from './types';

/** 渲染设置（响应式；设置页与各渲染器共用） */
export function useRenderSettings(): RenderSettings {
  return useStore((s) => s.renderSettings);
}
