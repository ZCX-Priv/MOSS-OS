// render/file/fetcher.ts
// 文件内容获取：
//   - GET /api/filesystem/raw    → 二进制（LRU 缓存 + objectURL），走 Authorization 头鉴权
//   - GET /api/filesystem/media  → 视频/音频直链（支持 HTTP Range 流式，鉴权走 query token）
//   - GET /api/filesystem/text   → 后端文本提取（Office/电子书等无前端渲染格式的回退）
// 后端走 filesys roots 权限体系。

const CACHE_MAX = 12;
const bufferCache = new Map<string, ArrayBuffer>(); // key: path（访问序即新鲜度）
const objectUrlCache = new Map<string, string>();

function getAuthToken(): string {
  return localStorage.getItem('moss-token') ?? '';
}

/** 获取文件二进制（LRU 缓存） */
export async function fetchFileBuffer(path: string): Promise<ArrayBuffer> {
  const hit = bufferCache.get(path);
  if (hit) {
    // 触碰新鲜度
    bufferCache.delete(path);
    bufferCache.set(path, hit);
    return hit;
  }
  const resp = await fetch(`/api/filesystem/raw?path=${encodeURIComponent(path)}`, {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  });
  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // 非 JSON 错误体
    }
    throw new Error(message);
  }
  const buffer = await resp.arrayBuffer();
  if (bufferCache.size >= CACHE_MAX) {
    const oldest = bufferCache.keys().next().value;
    if (oldest !== undefined) bufferCache.delete(oldest);
  }
  bufferCache.set(path, buffer);
  return buffer;
}

/** 获取文件 objectURL（图片/3D 模型加载器用；mime 用于 Blob 类型） */
export async function fetchFileObjectUrl(path: string, mime: string): Promise<string> {
  const cached = objectUrlCache.get(path);
  if (cached) return cached;
  const buffer = await fetchFileBuffer(path);
  const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
  objectUrlCache.set(path, url);
  return url;
}

/**
 * 视频/音频直链 URL：`<video>`/`<audio>` 无法携带 Authorization 头，
 * 故媒体路由改由 query token 鉴权（后端支持 Range 流式）。
 */
export function buildMediaUrl(path: string): string {
  return `/api/filesystem/media?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getAuthToken())}`;
}

export interface ExtractedText {
  text: string;
  truncated: boolean;
}

/**
 * 后端文本提取（Office/电子书/未知格式的通用回退）。
 * 失败时抛错，由调用方回退到「无法预览」卡片。
 */
export async function fetchExtractedText(path: string, maxChars = 200_000): Promise<ExtractedText> {
  const resp = await fetch(
    `/api/filesystem/text?path=${encodeURIComponent(path)}&maxChars=${maxChars}`,
    { headers: { Authorization: `Bearer ${getAuthToken()}` } },
  );
  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // 非 JSON 错误体
    }
    throw new Error(message);
  }
  return (await resp.json()) as ExtractedText;
}

/** 按扩展名推断 mime（与后端 RAW_MIME_MAP 对齐，供 objectURL / 解码使用） */
const MIME_BY_EXT: Record<string, string> = {
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
  // 电子书
  epub: 'application/epub+zip',
  opf: 'application/oebps-package+xml',
  fb2: 'application/x-fictionbook+xml',
  mobi: 'application/x-mobipocket-ebook',
  azw3: 'application/vnd.amazon.ebook',
  azw: 'application/vnd.amazon.ebook',
  // 网页 / 字体 / 压缩包
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xhtml: 'application/xhtml+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  eot: 'application/vnd.ms-fontobject',
  zip: 'application/zip',
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
  // 文本
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
};

export function mimeOfPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/** 浏览器可原生解码的图片（其余需 utif / heic2any 解码） */
export function isNativeImageExt(ext: string): boolean {
  return ['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'apng'].includes(
    ext.toLowerCase(),
  );
}

/** 浏览器可原生播放的视频容器（其余走回退提示） */
export function isNativeVideoExt(ext: string): boolean {
  return ['mp4', 'm4v', 'webm', 'ogv', 'mov'].includes(ext.toLowerCase());
}

/** 浏览器可原生播放的音频容器（其余走回退提示） */
export function isNativeAudioExt(ext: string): boolean {
  return ['mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'weba'].includes(
    ext.toLowerCase(),
  );
}