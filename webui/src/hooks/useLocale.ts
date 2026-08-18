import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale } from '../i18n';
import { idbSet } from '../utils/idb';
import { LOCALE_STORAGE_KEY } from '../i18n';
import { api } from '../api/http';

/**
 * 把前端 locale 同步到后端 config.server.locale（后端据此切换工具文本/描述语言）。
 * 幂等：后端 locale 已一致时不写入。后端不可达时静默失败（不影响前端语言切换）。
 */
export async function syncBackendLocale(locale: Locale): Promise<void> {
  try {
    const cfg = await api.getAppConfig();
    if (cfg.server.locale !== locale) {
      await api.updateAppConfig({ server: { ...cfg.server, locale } });
    }
  } catch {
    // 后端不可达：静默，前端语言切换不受影响
  }
}

/**
 * 语言切换 hook：封装 i18n.changeLanguage + idb 持久化 + DOM lang 同步 + 后端 locale 联动。
 * 翻译文本请直接使用 useTranslation()。
 */
export function useLocale() {
  const { i18n } = useTranslation();

  const setLocale = useCallback(
    (locale: Locale) => {
      void i18n.changeLanguage(locale);
      void idbSet(LOCALE_STORAGE_KEY, locale);
      document.documentElement.lang = locale;
      void syncBackendLocale(locale);
    },
    [i18n],
  );

  const currentLocale = (i18n.language === 'en' ? 'en' : 'zh') as Locale;

  return { locale: currentLocale, setLocale };
}
