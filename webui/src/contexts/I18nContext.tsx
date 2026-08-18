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
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY } from '../i18n';
import { idbGetSync, idbSet } from '../utils/idb';
import { syncBackendLocale } from '../hooks/useLocale';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function detectBrowserLocale(): Locale {
  const lang = navigator.language.toLowerCase();
  return lang.startsWith('zh') ? 'zh' : 'en';
}

function getInitialLocale(): Locale {
  const stored = idbGetSync<Locale>(LOCALE_STORAGE_KEY);
  if (stored === 'zh' || stored === 'en') {
    return stored;
  }
  return detectBrowserLocale();
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  // 挂载/切换时同步 DOM lang 属性、i18n 实例与后端 locale（幂等：后端一致时不写入）
  useEffect(() => {
    document.documentElement.lang = locale;
    if (i18n.language !== locale) {
      void i18n.changeLanguage(locale);
    }
    void syncBackendLocale(locale);
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    void i18n.changeLanguage(newLocale);
    void idbSet(LOCALE_STORAGE_KEY, newLocale);
    document.documentElement.lang = newLocale;
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
export { DEFAULT_LOCALE };
