// render/file/fetcher.ts
// 文件内容获取：GET /api/filesystem/raw（后端走 filesys roots 权限体系）+ LRU 缓存 + objectURL 管理。

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

/** 按扩展名推断 objectURL 的 mime（与后端 RAW_MIME_MAP 对齐） */
export function mimeOfPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    obj: 'text/plain',
    stl: 'text/plain',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    md: 'text/plain',
  };
  return map[ext] ?? 'application/octet-stream';
}
