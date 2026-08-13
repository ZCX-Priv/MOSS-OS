import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { idbGetSync, idbSet } from '../utils/idb';
import {
  runThemeTransition,
  type ThemeTransitionOrigin,
} from '../lib/themeTransition';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode, origin?: ThemeTransitionOrigin) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'moss-theme';

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialMode(): ThemeMode {
  const stored = idbGetSync<ThemeMode>(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemTheme() : mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(getInitialMode);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(getInitialMode()),
  );
  // 最近一次手动切换的扩散圆心（点击坐标）；系统自动切换无需设置
  const originRef = useRef<ThemeTransitionOrigin | undefined>(undefined);
  // 上一次实际应用的主题色，用于判断是否同色切换（同色时跳过动画）
  const lastResolvedRef = useRef<ResolvedTheme>(resolvedTheme);

  // 当 mode 变化时，同步 DOM 与 resolvedTheme（圆形扩散揭示动画）
  useEffect(() => {
    const resolved = resolveTheme(mode);
    if (resolved === lastResolvedRef.current) {
      // 同色切换（如 system→light 且系统本就是浅色）：无需动画，直接同步
      setResolvedTheme(resolved);
      document.documentElement.classList.toggle('dark', resolved === 'dark');
      return;
    }
    lastResolvedRef.current = resolved;
    runThemeTransition(
      () => {
        setResolvedTheme(resolved);
        document.documentElement.classList.toggle('dark', resolved === 'dark');
      },
      originRef.current,
    );
  }, [mode]);

  // 跟随系统模式：监听系统主题变化
  useEffect(() => {
    if (mode !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      const resolved: ResolvedTheme = e.matches ? 'dark' : 'light';
      runThemeTransition(() => {
        setResolvedTheme(resolved);
        document.documentElement.classList.toggle('dark', resolved === 'dark');
      });
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [mode]);

  const setMode = useCallback(
    (newMode: ThemeMode, origin?: ThemeTransitionOrigin) => {
      originRef.current = origin;
      setModeState(newMode);
      void idbSet(STORAGE_KEY, newMode);
    },
    [],
  );

  return (
    <ThemeContext.Provider value={{ mode, resolvedTheme, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
