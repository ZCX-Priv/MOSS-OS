import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale } from '../i18n';
import { idbSet } from '../utils/idb';
import { LOCALE_STORAGE_KEY } from '../i18n';

/**
 * 语言切换 hook：封装 i18n.changeLanguage + idb 持久化 + DOM lang 同步。
 * 翻译文本请直接使用 useTranslation()。
 */
export function useLocale() {
  const { i18n } = useTranslation();

  const setLocale = useCallback(
    (locale: Locale) => {
      void i18n.changeLanguage(locale);
      void idbSet(LOCALE_STORAGE_KEY, locale);
      document.documentElement.lang = locale;
    },
    [i18n],
  );

  const currentLocale = (i18n.language === 'en' ? 'en' : 'zh') as Locale;

  return { locale: currentLocale, setLocale };
}
