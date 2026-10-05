// render/file/detector.ts
// 文件类型检测：扩展名 → RendererKind（预览分发）。
// 本文件是「扩展名 → kind」的唯一真源；fetcher.mimeOfPath / FilePreviewCard / FilePreviewPane 均据此派生。

import type { RendererKind } from '../core/types';

// ── 各 kind 的扩展名集合（小写、不带点） ──────────────────────────────────────

/** 图片：浏览器原生可解码 + 需解码库（tiff/heic/netpbm/tga/jp2） */
const IMAGE_EXTS = [
  'png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'apng',
  // 需前端解码后转 canvas（utif / heic2any / 自写 netpbm / tga / openjpeg）
  'tiff', 'tif', 'heic', 'heif',
  'pbm', 'pgm', 'ppm', 'pnm', 'pam', 'tga',
  'jp2', 'j2k', 'jpf', 'jpx',
] as const;

/** 视频：原生可播（mp4/webm/ogv/mov）+ 需回退的容器（mkv/avi/wmv/flv…）
 *  注意：不含 'ts'——在开发工具语境下 .ts 绝大多数是 TypeScript，归入 code；
 *  MPEG-TS 用 'm2ts' 承载。扩展名跨 kind 冲突会导致解析依赖键顺序，故须唯一归属。
 *  flv 走 flv.js（MSE）播放，仍在 video kind 内分派。 */
const VIDEO_EXTS = [
  'mp4', 'm4v', 'webm', 'ogv', 'mov',
  'mkv', 'avi', 'wmv', 'flv', '3gp', '3g2', 'm2ts', 'mpg', 'mpeg', 'rmvb',
  // HLS 播放列表（Video.js 内置 VHS 处理）
  'm3u8',
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

/** LaTeX（公式渲染；源码经后端文本通道读取） */
const LATEX_EXTS = ['tex', 'latex', 'ltx'] as const;

/** 纯文本 / 代码 / 配置 */
const CODE_EXTS = [
  'txt', 'text', 'log',
  // 配置 / 数据
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env',
  'properties', 'gitignore', 'gitattributes', 'editorconfig', 'lock', 'dotenv',
  // 常见点文件（无基名、仅扩展名；与后端 preview-mime.ts 的 TEXT_EXTS 保持一致）
  'prettierrc', 'prettierignore', 'eslintrc', 'eslintignore', 'stylelintrc', 'babelrc',
  'npmrc', 'yarnrc', 'pnpmrc', 'nvmrc', 'dockerignore', 'gitmodules', 'gitkeep',
  'htaccess', 'jshintrc', 'browserslistrc', 'commitlintrc', 'lintstagedrc',
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

/** 分隔符 / 逐行 JSON 数据（表格预览） */
const DATA_EXTS = ['csv', 'tsv', 'ndjson', 'jsonl'] as const;

/** 字体（fontkit 覆盖 ttf/otf/woff/woff2/ttc/otc/dfont；eot 自解内嵌 TTF；Type1(.pfb/.pfm)/.fon 优雅回退） */
const FONT_EXTS = [
  'ttf', 'otf', 'ttc', 'otc', 'otb',
  'woff', 'woff2', 'eot',
  'dfont', 'fon', 'fnt',
  'pfb', 'pfm',
] as const;

/** 压缩包（统一 libarchive.js 解码：进入内层浏览） */
const ARCHIVE_EXTS = ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'cab'] as const;

/** 3D 模型（three examples/jsm loader 直接解析；不含需重型 WASM 的 stp/ifc/splat/3dm，也不含配套文件 mtl/mdd） */
const THREE_D_EXTS = [
  'glb', 'gltf', 'obj', 'stl', 'fbx', 'ply', '3mf', 'dae', '3ds', 'wrl', 'vrml', 'amf',
  'bvh', 'drc', 'gcode', 'kmz', 'md2', 'nrrd', 'pcd', 'pdb', 'usdz', 'vox', 'xyz',
] as const;

/** Office（有原生前端渲染）。WPS 文字（wps/wpt）按容器 magic 分派：ZIP→docx 引擎，OLE→后端文本回退 */
const DOCX_EXTS = ['docx', 'docm', 'dotx', 'wps', 'wpt'] as const;
/** Excel 家族：OOXML（自写引擎 SheetViewer，保样式）+ 旧版/二进制/ODS（SheetJS 兜底）+ WPS 表格 */
const XLSX_EXTS = ['xlsx', 'xlsm', 'xltx', 'xltm', 'xls', 'xlsb', 'xlt', 'ods', 'ots', 'fods', 'et', 'ett'] as const;
const PPTX_EXTS = ['pptx', 'pptm', 'potx', 'ppsx', 'dps', 'dpt'] as const;

/** OpenDocument 文本/演示 / RTF：走后端文本提取回退（表格类已归 office-xlsx） */
const ODF_EXTS = ['odt', 'odp', 'ott', 'otp', 'fodt', 'fodp', 'rtf'] as const;

/** Office 旧版二进制：走后端文本提取回退（Excel 旧版已归 office-xlsx） */
const LEGACY_OFFICE_EXTS = ['doc', 'ppt', 'dot', 'pot'] as const;

/** 字幕 / 歌词（专用时间轴渲染） */
const SUBTITLE_EXTS = ['srt', 'vtt', 'ass', 'ssa', 'lrc'] as const;

/** 日历（iCalendar） */
const CALENDAR_EXTS = ['ics', 'ifb'] as const;

/** 名片（vCard） */
const CONTACT_EXTS = ['vcf', 'vcard'] as const;

/** 地理数据（轨迹 / 要素） */
const GEO_EXTS = ['gpx', 'kml', 'geojson'] as const;

/** 证书（PEM / DER，渲染器内部识别） */
const CERTIFICATE_EXTS = ['pem', 'crt', 'cer', 'der', 'csr', 'p7b'] as const;

/** ICC 色彩配置文件 */
const COLORPROFILE_EXTS = ['icc', 'icm'] as const;

/** 2D 矢量图纸（AutoCAD DXF） */
const CAD_EXTS = ['dxf'] as const;

/** SQLite 数据库 */
const SQLITE_EXTS = ['sqlite', 'sqlite3', 'db', 'db3'] as const;

/** SWF（Flash，仅结构解析，不播放） */
const FLASH_EXTS = ['swf'] as const;

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
  latex: LATEX_EXTS,
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
  // 结构化文本 / 专用格式
  subtitle: SUBTITLE_EXTS,
  calendar: CALENDAR_EXTS,
  contact: CONTACT_EXTS,
  geo: GEO_EXTS,
  certificate: CERTIFICATE_EXTS,
  colorprofile: COLORPROFILE_EXTS,
  cad: CAD_EXTS,
  sqlite: SQLITE_EXTS,
  flash: FLASH_EXTS,
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