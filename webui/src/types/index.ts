// UI/src/types/index.ts
// UI 纯 UI 类型定义。业务/API 类型统一从 ./api re-export，保持单一真相源。

export type PageType = 'home' | 'task' | 'plugins' | 'automation' | 'settings';

export type OverlayType =
  | 'search'
  | 'user-menu'
  | 'agent-switch'
  | 'file-reference'
  | 'slash-command'
  | 'plan-mode'
  | null;

export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'render'
  | 'anim'
  | 'agent'
  | 'model'
  | 'context'
  | 'tools'
  | 'specs'
  | 'safety'
  | 'logs'
  | 'index'
  | 'commands'
  | 'rules'
  | 'memory'
  | 'hooks'
  | 'about';

export type AutomationTab = 'configured' | 'history' | 'templates';

// 统一 schema：TaskItem / TaskGroup 从 api.ts re-export
export type { TaskItem, TaskGroup } from './api';
