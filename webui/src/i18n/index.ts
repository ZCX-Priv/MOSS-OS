import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { zh } from './locales/zh';
import { en } from './locales/en';

/** 用户可选语言（含"自动检测"） */
export const LOCALE_CHOICES = ['auto', 'zh', 'en'] as const;
export type Locale = (typeof LOCALE_CHOICES)[number];
/** 实际生效语言（i18next 与后端只认 zh/en） */
export type ResolvedLocale = 'zh' | 'en';
/** 拥有翻译资源的语言 */
export const SUPPORTED_LOCALES = ['zh', 'en'] as const;
export const DEFAULT_LOCALE: Locale = 'auto';
export const LOCALE_STORAGE_KEY = 'moss-locale';

/** 把用户选择解析为实际语言：auto → 按浏览器语言检测（zh* 开头取 zh，否则 en） */
export function resolveLocale(locale: Locale): ResolvedLocale {
  if (locale !== 'auto') return locale;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export const resources = {
  zh: { translation: zh },
  en: { translation: en },
};

i18n.use(initReactI18next).init({
  resources,
  lng: resolveLocale(DEFAULT_LOCALE),
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
  returnNull: false,
});

// Vite HMR 接缝：编辑 locales/*.ts 时，模块重新执行产出新的 resources，
// 此处把最新资源包写入 i18next 单例并触发重渲染，实现文案热更新（无需硬刷新）。
if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    if (!mod?.resources) return;
    for (const lng of SUPPORTED_LOCALES) {
      i18n.addResourceBundle(
        lng,
        'translation',
        mod.resources[lng]?.translation ?? {},
        true, // deep
        true, // overwrite
      );
    }
    void i18n.reloadResources([...SUPPORTED_LOCALES]);
  });
}

export default i18n;
