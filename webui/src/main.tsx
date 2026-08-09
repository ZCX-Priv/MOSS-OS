import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.tsx'
import { ThemeProvider } from './contexts/ThemeContext'
import { I18nProvider } from './contexts/I18nContext'
import { idbGet } from './utils/idb'
import i18n, { type Locale, LOCALE_STORAGE_KEY } from './i18n'
import './styles/global.css'

type ThemeMode = 'light' | 'dark' | 'system';

// 防止主题闪烁：在 React 渲染前异步从 IndexedDB 读取主题并设置 data-theme
async function initTheme() {
  const stored = await idbGet<ThemeMode>('moss-theme');
  const mode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark';
  const resolved = mode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

// 防止语言闪烁：在 React 渲染前异步从 IndexedDB 读取语言并初始化 i18n
async function initLocale() {
  const stored = await idbGet<Locale>(LOCALE_STORAGE_KEY);
  const browserLang = navigator.language.toLowerCase();
  const locale: Locale =
    stored === 'zh' || stored === 'en'
      ? stored
      : browserLang.startsWith('zh')
        ? 'zh'
        : 'en';
  await i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
}

Promise.all([initTheme(), initLocale()]).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider>
        <I18nProvider>
          <HashRouter>
            <App />
          </HashRouter>
        </I18nProvider>
      </ThemeProvider>
    </StrictMode>,
  );
});
