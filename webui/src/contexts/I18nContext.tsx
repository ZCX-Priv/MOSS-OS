import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import i18n from '../i18n';
import type { Locale } from '../i18n';
import { resolveLocale, LOCALE_STORAGE_KEY } from '../i18n';
import { idbGetSync, idbSet } from '../utils/idb';
import { syncBackendLocale } from '../hooks/useLocale';

interface I18nContextValue {
  /** 用户选择的语言（可含 'auto'），持久化与设置页下拉显示用该值 */
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function getInitialLocale(): Locale {
  const stored = idbGetSync<Locale>(LOCALE_STORAGE_KEY);
  if (stored === 'zh' || stored === 'en' || stored === 'auto') {
    return stored;
  }
  return 'auto';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // state 保存用户选择值（可含 'auto'）；实际生效语言由 resolveLocale 解析
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  // 挂载/切换时同步 DOM lang 属性、i18n 实例与后端 locale（幂等：后端一致时不写入）
  useEffect(() => {
    const resolved = resolveLocale(locale);
    document.documentElement.lang = resolved;
    if (i18n.language !== resolved) {
      void i18n.changeLanguage(resolved);
    }
    void syncBackendLocale(resolved);
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    const resolved = resolveLocale(newLocale);
    void i18n.changeLanguage(resolved);
    void idbSet(LOCALE_STORAGE_KEY, newLocale);
    document.documentElement.lang = resolved;
  }, []);

  return (
    <I18nContext.Provider value={{ locale, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}

// 默认导出 DEFAULT_LOCALE 以兼容可能的预加载场景
export { DEFAULT_LOCALE } from '../i18n';
