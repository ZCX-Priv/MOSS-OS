// render/core/use-dark-mode.ts
// 主题检测 hook：MutationObserver 监听 <html> class 变化（项目主题机制是 toggle 'dark' class）。
// 不依赖 React Context —— render 模块可在任何 Provider 层级外使用。

import { useEffect, useState } from 'react';

export function useDarkMode(): boolean {
  const [dark, setDark] = useState<boolean>(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false,
  );

  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => {
      setDark(el.classList.contains('dark'));
    });
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return dark;
}
