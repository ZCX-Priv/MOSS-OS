// src/core/i18n.ts
// 后端轻量 i18n：支持 zh/en，默认 zh

import { zh } from './i18n/locales/zh';
import { en } from './i18n/locales/en';

export type BackendLocale = 'zh' | 'en';

const resources: Record<BackendLocale, Record<string, unknown>> = { zh, en };
let currentLocale: BackendLocale = 'zh';

export function setBackendLocale(locale: BackendLocale): void {
  currentLocale = locale;
}

export function getBackendLocale(): BackendLocale {
  return currentLocale;
}

/** 翻译函数：支持 {{param}} 插值 */
export function t(key: string, params?: Record<string, string | number>): string {
  const table = resources[currentLocale];
  const parts = key.split('.');
  let cur: unknown = table;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  if (typeof cur !== 'string') return key;
  if (!params) return cur;
  return cur.replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k] ?? ''));
}
