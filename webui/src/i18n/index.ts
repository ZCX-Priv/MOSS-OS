import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { zh } from './locales/zh';
import { en } from './locales/en';

export const SUPPORTED_LOCALES = ['zh', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh';
export const LOCALE_STORAGE_KEY = 'moss-locale';

export const resources = {
  zh: { translation: zh },
  en: { translation: en },
};

i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LOCALE,
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
