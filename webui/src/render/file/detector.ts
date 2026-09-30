// render/file/detector.ts
// 文件类型检测：扩展名 → RendererKind（预览分发）。

import type { RendererKind } from '../core/types';

// 纯文本/代码/配置类扩展名（预览时按纯文本渲染；正文内联卡片仍回退 code 文本）
const TEXT_EXTS = [
  'txt', 'md', 'markdown',
  // 配置 / 数据
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env',
  'gitignore', 'gitattributes', 'editorconfig', 'lock', 'csv', 'tsv', 'log',
  'makefile', 'dockerfile',
  // 代码
  'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1',
  'py', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts',
  'rs', 'go', 'java', 'kt', 'kts', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'php', 'rb',
  'swift', 'r', 'lua', 'vue', 'svelte', 'dart', 'scala', 'pl', 'sql',
  // 标记 / 样式
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'xsl', 'svgz',
] as const;

const KIND_BY_EXT: Record<string, RendererKind> = {
  docx: 'office-docx',
  xlsx: 'office-xlsx',
  pptx: 'office-pptx',
  pdf: 'pdf',
  glb: 'three-d',
  gltf: 'three-d',
  obj: 'three-d',
  stl: 'three-d',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  ico: 'image',
  avif: 'image',
  ...Object.fromEntries(TEXT_EXTS.map((e) => [e, 'text' as RendererKind])),
};

export function fileExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function detectFileKind(path: string): RendererKind {
  return KIND_BY_EXT[fileExtension(path)] ?? 'unknown';
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
