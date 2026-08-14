// src/core/i18n.ts
// 后端轻量 i18n：支持 zh/en，默认 zh

import { zh } from './i18n/locales/zh';
import { en } from './i18n/locales/en';

export type BackendLocale = 'zh' | 'en';

const resources: Record<BackendLocale, Record<string, unknown>> = { zh, en };
let currentLocale: BackendLocale = 'zh';

/**
 * 运行期就地重载语言资源：带缓存破坏参数动态导入 locale 模块并替换资源表。
 * 用于开发/代理写入场景下让运行中的 t() 立即反映磁盘文案变更，无需重启进程。
 */
export async function reloadBackendResources(): Promise<void> {
  const [zhMod, enMod] = await Promise.all([
    import(`./i18n/locales/zh?t=${Date.now()}`),
    import(`./i18n/locales/en?t=${Date.now()}`),
  ]);
  resources.zh = zhMod.zh;
  resources.en = enMod.en;
}

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
