// render/code/shiki.ts
// Shiki 引擎懒加载：dynamic import + 语言按需注册 + 双主题（github-light/github-dark）。
// 双主题输出 CSS vars（--shiki-light / --shiki-dark），亮暗切换由 CSS 完成，零重渲。

import type { Highlighter } from 'shiki';

/** 常见语言别名 → Shiki 语言 id */
const LANG_ALIAS: Record<string, string> = {
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  'c++': 'cpp',
  cc: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  yml: 'yaml',
  md: 'markdown',
  rs: 'rust',
  dockerfile: 'dockerfile',
  text: 'plaintext',
  txt: 'plaintext',
  plain: 'plaintext',
  ini: 'ini',
  conf: 'ini',
};

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>();

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then((shiki) =>
      shiki.createHighlighter({
        themes: ['github-light', 'github-dark'],
        langs: [],
      }),
    );
  }
  return highlighterPromise;
}

/** 解析语言名：别名 → Shiki id；未知返回 null（回退纯文本） */
async function resolveLang(lang: string): Promise<string | null> {
  const normalized = lang.trim().toLowerCase();
  if (!normalized) return null;
  const candidate = LANG_ALIAS[normalized] ?? normalized;
  const shiki = await import('shiki');
  const bundled = shiki.bundledLanguages as Record<string, unknown>;
  if (candidate in bundled) return candidate;
  // 试 lazy 动态键（如 vue/html 嵌套别名极少，直接放弃）
  return null;
}

/**
 * 高亮代码为 HTML 字符串（双主题 CSS vars）。
 * 语言未注册/引擎失败返回 null —— 调用方回退纯文本。
 */
export async function highlightCode(code: string, lang: string): Promise<string | null> {
  try {
    const resolved = await resolveLang(lang);
    if (!resolved) return null;
    const highlighter = await getHighlighter();
    if (!loadedLangs.has(resolved)) {
      await highlighter.loadLanguage(resolved as Parameters<Highlighter['loadLanguage']>[0]);
      loadedLangs.add(resolved);
    }
    return highlighter.codeToHtml(code, {
      lang: resolved,
      themes: { light: 'github-light', dark: 'github-dark' },
    });
  } catch {
    return null;
  }
}
