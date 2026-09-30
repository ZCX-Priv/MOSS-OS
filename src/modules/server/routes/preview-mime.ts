// modules/server/routes/preview-mime.ts
// 文件预览的「扩展名 → MIME」真源（纯模块：不 import 任何重依赖，便于脚本直接校验）。
//
// 背景（回归根因）：前端 webui/src/render/file/detector.ts 把大量代码/配置/标记类扩展名
// 归为可预览类型，但后端白名单曾遗漏它们 → /api/filesystem/raw 返回 415「不支持」。
// 因此这里显式补全全部文本类扩展名，并由一致性脚本（见验证步骤）断言
// 「前端 KIND_EXTENSIONS 的每个扩展名都在 RAW_MIME_MAP 中」，从根上防止再次漂移。

/** 文本类文件的统一 MIME */
export const MIME_BY_TEXT = 'text/plain; charset=utf-8';

/**
 * 文本类扩展名（与前端 detector.ts 的 CODE_EXTS + MARKDOWN_EXTS + HTML_EXTS + DATA_EXTS 对齐）。
 * 这些扩展名走「文本通道」：/api/filesystem/text 直接解码返回（bounded + 编码检测）。
 * 注意：不含 svg（图片）、opf/fb2（电子书，走专用解析 handler）。
 */
const TEXT_EXTS: readonly string[] = [
  'txt', 'text', 'log',
  // Markdown
  'md', 'markdown', 'mdx',
  // HTML（前端按 html 预览，但内容是文本，仍需文本通道可取）
  'html', 'htm', 'xhtml',
  // 数据（分隔符）
  'csv', 'tsv',
  // 扁平 XML 的 OpenDocument（非 zip 容器，直接按文本预览）
  'fodt', 'fods', 'fodp',
  // 配置 / 数据
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env',
  'properties', 'gitignore', 'gitattributes', 'editorconfig', 'lock', 'dotenv',
  'makefile', 'dockerfile', 'cmake', 'gradle', 'bazel', 'tf', 'tfvars', 'hcl', 'nomad',
  // 代码
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'psm1', 'nu',
  'py', 'pyi', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts',
  'rs', 'go', 'java', 'kt', 'kts', 'groovy', 'c', 'h', 'cpp', 'hpp', 'cc', 'hh',
  'cxx', 'cs', 'php', 'rb', 'swift', 'm', 'mm', 'r', 'lua', 'vue', 'svelte', 'dart',
  'scala', 'sc', 'pl', 'pm', 'ex', 'exs', 'erl', 'hrl', 'clj', 'cljs', 'edn', 'hs',
  'ml', 'mli', 'fs', 'fsx', 'vb', 'jl', 'nim', 'zig', 'v', 'asm', 's', 'sql', 'graphql',
  'gql', 'proto', 'thrift', 'sol', 'wasm', 'wat',
  // 标记 / 样式 / 补丁
  'css', 'scss', 'sass', 'less', 'styl', 'xml', 'xsl', 'xslt', 'dtd', 'plist', 'svgz',
  'http', 'rest', 'diff', 'patch',
];

/**
 * 基础 MIME 表（二进制与专有格式；优先级高于 MIME_BY_TEXT 兜底）。
 * 与 webui/src/render/file/fetcher.ts 的 MIME_BY_EXT 对齐。
 */
const BASE_MIME: Record<string, string> = {
  // 文档
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  docm: 'application/vnd.ms-word.document.macroenabled.12',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroenabled.12',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  xltm: 'application/vnd.ms-excel.template.macroenabled.12',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  potx: 'application/vnd.openxmlformats-officedocument.presentationml.template',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  /** 旧版 Office 模板族（与 doc/xls/ppt 同容器） */
  dot: 'application/msword',
  xlt: 'application/vnd.ms-excel',
  pot: 'application/vnd.ms-powerpoint',
  // OpenDocument / RTF（含模板族；fodt/fods/fodp 为扁平 XML，归入文本类见 TEXT_EXTS）
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  ott: 'application/vnd.oasis.opendocument.text-template',
  ots: 'application/vnd.oasis.opendocument.spreadsheet-template',
  otp: 'application/vnd.oasis.opendocument.presentation-template',
  rtf: 'application/rtf',
  // 电子书
  epub: 'application/epub+zip',
  opf: 'application/oebps-package+xml',
  mobi: 'application/x-mobipocket-ebook',
  azw3: 'application/vnd.amazon.ebook',
  azw: 'application/vnd.amazon.ebook',
  fb2: 'application/x-fictionbook+xml',
  // 网页（保留正确 MIME；文本通道由 TEXT_PREVIEW_EXTS 单独放行）
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xhtml: 'application/xhtml+xml',
  // 字体
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  eot: 'application/vnd.ms-fontobject',
  // 压缩包
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  bz2: 'application/x-bzip2',
  xz: 'application/x-xz',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  // 3D
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  obj: 'text/plain; charset=utf-8',
  mtl: 'text/plain; charset=utf-8',
  stl: 'model/stl',
  fbx: 'application/octet-stream',
  ply: 'application/octet-stream',
  '3mf': 'model/3mf',
  dae: 'model/vnd.collada+xml',
  '3ds': 'application/octet-stream',
  wrl: 'model/vrml',
  vrml: 'model/vrml',
  amf: 'application/x-amf',
  // 图片
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  apng: 'image/apng',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  // 视频
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  rmvb: 'application/vnd.rn-realmedia-vbr',
  // 音频
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  weba: 'audio/webm',
  wma: 'audio/x-ms-wma',
  amr: 'audio/amr',
  mid: 'audio/midi',
  midi: 'audio/midi',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
};

/**
 * 预览扩展名白名单 → MIME。
 * 基础表优先（保留 html/text/xml 的专有 MIME），其余文本类扩展名兜底为 text/plain。
 */
export const RAW_MIME_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = { ...BASE_MIME };
  for (const ext of TEXT_EXTS) {
    if (!(ext in map)) map[ext] = MIME_BY_TEXT;
  }
  return map;
})();

/** 文本类扩展名集合（/api/filesystem/text 的直接解码分支） */
export const TEXT_PREVIEW_EXTS = new Set<string>(TEXT_EXTS);

/** 是否为文本类扩展名（大小写不敏感） */
export function isTextualExt(ext: string): boolean {
  return TEXT_PREVIEW_EXTS.has(ext.toLowerCase());
}

/** 视频/音频扩展名（/api/filesystem/media 白名单，防退化为任意文件下载器）
 *  注意：不含 'ts'——它在前端归属 TypeScript（文本），MPEG-TS 由 'm2ts' 承载。 */
export const MEDIA_EXTS = new Set<string>([
  'mp4', 'm4v', 'webm', 'ogv', 'mov', 'mkv', 'avi', 'wmv', 'flv', '3gp', '3g2',
  'm2ts', 'mpg', 'mpeg', 'rmvb',
  'mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'weba', 'wma', 'amr',
  'mid', 'midi', 'aiff', 'aif',
]);

/** 文本类扩展名清单（供一致性脚本与文档使用） */
export const TEXT_EXTENSIONS: readonly string[] = TEXT_EXTS;