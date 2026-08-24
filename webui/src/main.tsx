import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.tsx'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { ThemeProvider } from './contexts/ThemeContext'
import { I18nProvider } from './contexts/I18nContext'
import { idbGet, idbSet, migrateLegacyDatabase } from './utils/idb'
import { useStore, type PersistedState, LEGACY_DEFAULT_WORKING_DIRECTORY, DEFAULT_WORKING_DIRECTORY } from './store'
import { isValidRenderSettings } from './render/core/types'
import { isValidAnimationSettings } from './types/animation'
import i18n, { type Locale, resolveLocale, LOCALE_STORAGE_KEY } from './i18n'
import './styles/global.css'

type ThemeMode = 'light' | 'dark' | 'system';

// 防止主题闪烁：在 React 渲染前异步从 IndexedDB 读取主题并设置 data-theme
async function initTheme() {
  try {
    const stored = await idbGet<ThemeMode>('moss-theme');
    const mode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark';
    const resolved = mode === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  } catch (err) {
    // 启动兜底：主题读取失败按默认深色渲染，不阻塞应用启动
    console.warn('initTheme failed, fallback to dark:', err);
    document.documentElement.classList.add('dark');
  }
}

// 防止语言闪烁：在 React 渲染前异步从 IndexedDB 读取语言并初始化 i18n
// 存储值为用户选择（'auto' | 'zh' | 'en'）；未设置过时默认 'auto'，实际语言由 resolveLocale 解析
async function initLocale() {
  try {
    const stored = await idbGet<Locale>(LOCALE_STORAGE_KEY);
    const locale: Locale =
      stored === 'zh' || stored === 'en' || stored === 'auto' ? stored : 'auto';
    const resolved = resolveLocale(locale);
    await i18n.changeLanguage(resolved);
    document.documentElement.lang = resolved;
  } catch (err) {
    // 启动兜底：语言初始化失败按默认语言继续，不阻塞应用启动
    console.warn('initLocale failed, fallback to default locale:', err);
  }
}

// store 中需要持久化的 key 列表（与 store 内 idbSet 使用的 key 保持一致）
const PERSISTED_KEYS = [
  'moss-working-directory',
  'moss-recent-directories',
  'moss-send-shortcut',
  'moss-permission-mode',
  'moss-sidebar-tabs',
  'moss-active-sidebar-tab',
  'moss-render-settings',
  'moss-animation-settings',
] as const;

/**
 * 预填充 store 的持久化状态到 IndexedDB 内存缓存，并执行一次性迁移：
 * 仅当 IndexedDB 中该 key 无值而旧 localStorage 有值时，把旧值搬入 IndexedDB 并清除 localStorage。
 */
async function prefetchStoreState(): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const key of PERSISTED_KEYS) {
    const current = await idbGet<unknown>(key);
    if (current === undefined) {
      const legacy = localStorage.getItem(key);
      if (legacy !== null) {
        let migrated: unknown = legacy;
        try {
          migrated = JSON.parse(legacy);
        } catch {
          // 非 JSON，按普通字符串处理
        }
        await idbSet(key, migrated);
        localStorage.removeItem(key);
        result[key] = migrated;
      }
    } else {
      result[key] = current;
    }
  }
  // 存量迁移：旧默认工作目录（C:\）→ 本机 System 哨兵（覆盖 IndexedDB 与旧 localStorage 两来源）
  if (result['moss-working-directory'] === LEGACY_DEFAULT_WORKING_DIRECTORY) {
    result['moss-working-directory'] = DEFAULT_WORKING_DIRECTORY;
    await idbSet('moss-working-directory', DEFAULT_WORKING_DIRECTORY);
  }
  return result;
}

// 先迁移旧库数据到 MOSS-DB，再预填充 store 状态（迁移写入内存缓存后，预填充即可命中）
async function initPersisted(): Promise<Record<string, unknown>> {
  try {
    await migrateLegacyDatabase();
    return await prefetchStoreState();
  } catch (err) {
    // 启动兜底：持久化状态读取失败按空状态继续（全部回落默认值）
    console.warn('initPersisted failed, fallback to defaults:', err);
    return {};
  }
}

function buildPersistedState(data: Record<string, unknown>): PersistedState {
  return {
    workingDirectory:
      typeof data['moss-working-directory'] === 'string'
        ? (data['moss-working-directory'] as string)
        : undefined,
    recentDirectories: Array.isArray(data['moss-recent-directories'])
      ? (data['moss-recent-directories'] as string[])
      : undefined,
    sendShortcut:
      data['moss-send-shortcut'] === 'enter' || data['moss-send-shortcut'] === 'ctrl-enter'
        ? (data['moss-send-shortcut'] as 'enter' | 'ctrl-enter')
        : undefined,
    permissionMode:
      data['moss-permission-mode'] === 'ask' ||
      data['moss-permission-mode'] === 'auto' ||
      data['moss-permission-mode'] === 'skip'
        ? (data['moss-permission-mode'] as 'ask' | 'auto' | 'skip')
        : undefined,
    sidebarTabs: Array.isArray(data['moss-sidebar-tabs'])
      ? (data['moss-sidebar-tabs'] as PersistedState['sidebarTabs'])
      : undefined,
    activeSidebarTabId:
      typeof data['moss-active-sidebar-tab'] === 'string'
        ? (data['moss-active-sidebar-tab'] as string)
        : undefined,
    renderSettings: isValidRenderSettings(data['moss-render-settings'])
      ? data['moss-render-settings']
      : undefined,
    animationSettings: isValidAnimationSettings(data['moss-animation-settings'])
      ? data['moss-animation-settings']
      : undefined,
  };
}

Promise.all([initTheme(), initLocale(), initPersisted()]).then((results) => {
  const persisted = results[2];
  useStore.getState().hydratePersisted(buildPersistedState(persisted));
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <ThemeProvider>
          <I18nProvider>
            <HashRouter>
              <App />
            </HashRouter>
          </I18nProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}).catch((err: unknown) => {
  // 启动链路最后兜底：任何未预期异常也要给用户可见反馈，而非白屏
  console.error('App bootstrap failed:', err);
  const root = document.getElementById('root');
  if (root) {
    const msg = String(err instanceof Error ? err.message : err).replace(
      /[<>&]/g,
      (c: string) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'),
    );
    root.innerHTML = [
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#09090b;color:#e4e4e7;font-family:system-ui,sans-serif;">',
      '  <div style="max-width:480px;padding:32px;text-align:center;">',
      '    <h1 style="font-size:20px;margin:0 0 12px;">MOSS 启动失败 / Bootstrap failed</h1>',
      '    <p style="font-size:13px;color:#a1a1aa;margin:0 0 16px;word-break:break-all;">' + msg + '</p>',
      '    <button onclick="location.reload()" style="padding:8px 20px;border-radius:8px;border:1px solid #3f3f46;background:#18181b;color:#e4e4e7;cursor:pointer;">重新加载 / Reload</button>',
      '  </div>',
      '</div>',
    ].join('');
  }
});
