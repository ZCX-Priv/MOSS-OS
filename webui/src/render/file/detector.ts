// render/file/detector.ts
// 文件类型检测：扩展名 → RendererKind（预览分发）。
// 本文件是「扩展名 → kind」的唯一真源；fetcher.mimeOfPath / FilePreviewCard / FilePreviewPane 均据此派生。

import type { RendererKind } from '../core/types';

// ── 各 kind 的扩展名集合（小写、不带点） ──────────────────────────────────────

/** 图片：浏览器原生可解码 + 需解码库（tiff/heic） */
const IMAGE_EXTS = [
  'png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'apng',
  // 需前端解码后转 canvas（utif / heic2any）
  'tiff', 'tif', 'heic', 'heif',
] as const;

/** 视频：原生可播（mp4/webm/ogv/mov）+ 需回退的容器（mkv/avi/wmv/flv…）
 *  注意：不含 'ts'——在开发工具语境下 .ts 绝大多数是 TypeScript，归入 code；
 *  MPEG-TS 用 'm2ts' 承载。扩展名跨 kind 冲突会导致解析依赖键顺序，故须唯一归属。 */
const VIDEO_EXTS = [
  'mp4', 'm4v', 'webm', 'ogv', 'mov',
  'mkv', 'avi', 'wmv', 'flv', '3gp', '3g2', 'm2ts', 'mpg', 'mpeg', 'rmvb',
] as const;

/** 音频 */
const AUDIO_EXTS = [
  'mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'weba',
  'wma', 'amr', 'mid', 'midi', 'aiff', 'aif',
] as const;

/** 电子书 */
const EBOOK_EXTS = ['epub', 'opf', 'mobi', 'azw3', 'azw', 'fb2'] as const;

/** 网页 */
const HTML_EXTS = ['html', 'htm', 'xhtml'] as const;

/** Markdown */
const MARKDOWN_EXTS = ['md', 'markdown', 'mdx'] as const;

/** 纯文本 / 代码 / 配置 */
const CODE_EXTS = [
  'txt', 'text', 'log',
  // 配置 / 数据
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env',
  'properties', 'gitignore', 'gitattributes', 'editorconfig', 'lock', 'dotenv',
  'makefile', 'dockerfile', 'cmake', 'bazel', 'tf', 'tfvars', 'hcl', 'nomad',
  // 代码
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'psm1', 'nu',
  'py', 'pyi', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts',
  'rs', 'go', 'java', 'kt', 'kts', 'gradle', 'groovy', 'c', 'h', 'cpp', 'hpp', 'cc', 'hh',
  'cxx', 'cs', 'php', 'rb', 'swift', 'm', 'mm', 'r', 'lua', 'vue', 'svelte', 'dart',
  'scala', 'sc', 'pl', 'pm', 'ex', 'exs', 'erl', 'hrl', 'clj', 'cljs', 'edn', 'hs',
  'ml', 'mli', 'fs', 'fsx', 'vb', 'jl', 'nim', 'zig', 'v', 'asm', 's', 'sql', 'graphql',
  'gql', 'proto', 'thrift', 'sol', 'wasm', 'wat',
  // 标记 / 样式
  'css', 'scss', 'sass', 'less', 'styl', 'xml', 'xsl', 'xslt', 'dtd', 'plist', 'svgz',
  'http', 'rest', 'diff', 'patch',
] as const;

/** 分隔符数据（表格预览） */
const DATA_EXTS = ['csv', 'tsv'] as const;

/** 字体 */
const FONT_EXTS = ['ttf', 'otf', 'woff', 'woff2', 'eot'] as const;

/** 压缩包 */
const ARCHIVE_EXTS = ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar'] as const;

/** 3D 模型 */
const THREE_D_EXTS = [
  'glb', 'gltf', 'obj', 'stl', 'fbx', 'ply', '3mf', 'dae', '3ds', 'wrl', 'vrml', 'amf', 'mtl',
] as const;

/** Office（有原生前端渲染） */
const DOCX_EXTS = ['docx', 'docm', 'dotx'] as const;
const XLSX_EXTS = ['xlsx', 'xlsm', 'xltx', 'xltm'] as const;
const PPTX_EXTS = ['pptx', 'pptm', 'potx', 'ppsx'] as const;

/** OpenDocument / RTF：走后端文本提取回退 */
const ODF_EXTS = ['odt', 'ods', 'odp', 'ott', 'ots', 'otp', 'fodt', 'fods', 'fodp', 'rtf'] as const;

/** Office 旧版二进制：走后端文本提取回退 */
const LEGACY_OFFICE_EXTS = ['doc', 'xls', 'ppt', 'dot', 'xlt', 'pot'] as const;

// ── 扩展名 → kind 映射表 ────────────────────────────────────────────────────

/**
 * 各 kind 的扩展名清单 —— 「可预览扩展名」的单一真源。
 * 一致性脚本据此断言「后端 RAW_MIME_MAP 覆盖这里出现的每个扩展名」，从根上防止
 * 「前端认为可预览、后端却 415 不支持」的回归。
 */
export const KIND_EXTENSIONS: Record<RendererKind, readonly string[]> = {
  image: IMAGE_EXTS,
  video: VIDEO_EXTS,
  audio: AUDIO_EXTS,
  ebook: EBOOK_EXTS,
  html: HTML_EXTS,
  markdown: MARKDOWN_EXTS,
  code: CODE_EXTS,
  data: DATA_EXTS,
  font: FONT_EXTS,
  archive: ARCHIVE_EXTS,
  'three-d': THREE_D_EXTS,
  'office-docx': DOCX_EXTS,
  'office-xlsx': XLSX_EXTS,
  'office-pptx': PPTX_EXTS,
  'office-odf': ODF_EXTS,
  'office-legacy': LEGACY_OFFICE_EXTS,
  pdf: ['pdf'],
  // 当前无扩展名映射到 text（txt/log 归入 code）；unknown 为未识别，二者不参与白名单校验
  text: [],
  unknown: [],
};

const KIND_BY_EXT: Record<string, RendererKind> = Object.fromEntries(
  (Object.entries(KIND_EXTENSIONS) as Array<[RendererKind, readonly string[]]>).flatMap(([kind, exts]) =>
    exts.map((e) => [e, kind] as [string, RendererKind]),
  ),
);

// ── 公共纯函数 ──────────────────────────────────────────────────────────────

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

/** 视频/音频：可用「直链 + query token」流式播放（Range），无需先整读入内存 */
export function isStreamableMedia(kind: RendererKind): boolean {
  return kind === 'video' || kind === 'audio';
}