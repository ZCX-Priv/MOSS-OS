import type { zh } from './locales/zh';

// 资源类型：基于中文资源结构推断，保证 key 类型安全，避免使用 any
export type ResourceType = typeof zh;
