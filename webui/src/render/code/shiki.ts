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
  pyi: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  'c++': 'cpp',
  cc: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  yml: 'yaml',
  md: 'markdown',
  mdx: 'mdx',
  rs: 'rust',
  dockerfile: 'dockerfile',
  text: 'plaintext',
  txt: 'plaintext',
  plain: 'plaintext',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
  env: 'dotenv',
  dotenv: 'dotenv',
  toml: 'toml',
  makefile: 'make',
  mk: 'make',
  cmake: 'cmake',
  pl: 'perl',
  pm: 'perl',
  kt: 'kotlin',
  kts: 'kotlin',
  sc: 'scala',
  ex: 'elixir',
  exs: 'elixir',
  exts: 'elixir',
  clj: 'clojure',
  cljs: 'clojure',
  hs: 'haskell',
  fs: 'fsharp',
  m: 'objective-c',
  mm: 'objective-cpp',
  proto: 'proto',
  gql: 'graphql',
  styl: 'stylus',
  sass: 'sass',
  xsl: 'xml',
  xslt: 'xml',
  plist: 'xml',
  dtd: 'xml',
  htm: 'html',
  xhtml: 'html',
  diff: 'diff',
  patch: 'diff',
  vrml: 'vrml',
  wrl: 'vrml',
  log: 'log',
  properties: 'properties',
};

/** 文件名（无扩展名 / 特殊文件名）→ Shiki 语言 id */
const FILENAME_LANG: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'make',
  'cmakelists.txt': 'cmake',
  '.gitignore': 'gitignore',
  '.gitattributes': 'gitignore',
  '.editorconfig': 'ini',
  '.env': 'dotenv',
};

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>();

/**
 * 从文件路径推断 Shiki 语言候选 id（别名已归一；未知返回扩展名本身）。
 * 返回值仍需经 resolveLang 校验是否在 bundledLanguages 内；不在则调用方回退纯文本。
 */
export function langFromPath(path: string): string {
  const name = (path.split(/[\\/]/).pop() ?? '').toLowerCase();
  if (FILENAME_LANG[name]) return FILENAME_LANG[name];
  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? '' : name.slice(dot + 1);
  if (!ext) return '';
  return LANG_ALIAS[ext] ?? ext;
}

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
