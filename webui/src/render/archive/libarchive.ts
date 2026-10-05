// render/archive/libarchive.ts
// 压缩包解析服务（libarchive.js：WASM + Worker，动态加载，不进首屏 chunk）。
// 职责：
//  - 单例 init（workerUrl 只设置一次）；
//  - 打开压缩包并列出条目（ArchivePane 用）；
//  - 按「外层路径 + 内层条目路径」提取条目字节 —— 供「压缩包内层标签页」在刷新后自动恢复内容。
// 与 fetcher 的 LRU 配合：按路径提取时复用已缓存的外层压缩包字节，避免重复下载。

import { fetchFileBuffer } from '../file/fetcher';

/** libarchive CompressedFile 的最小结构 */
export interface CompressedFileLike {
  name: string;
  size: number;
  lastModified: number;
  extract(): Promise<File>;
}

/** libarchive ArchiveReader 的最小结构 */
export interface ArchiveReaderLike {
  getFilesArray(): Promise<Array<{ file: CompressedFileLike | string; path: string }>>;
  close(): Promise<void>;
}

interface ArchiveModuleLike {
  init(options?: { workerUrl?: string }): unknown;
  open(file: File): Promise<ArchiveReaderLike>;
}

/** 压缩包内层条目信息 */
export interface ArchiveEntryInfo {
  /** 内层完整路径（相对压缩包根，含子目录，'/' 分隔）—— 持久化与提取的唯一键 */
  innerPath: string;
  /** 条目所在目录（'' 为根，其余以 '/' 结尾） */
  dir: string;
  /** 条目文件名 */
  name: string;
  size: number;
  cf: CompressedFileLike;
}

let archiveModulePromise: Promise<ArchiveModuleLike> | null = null;

/** 获取（并首次初始化）libarchive Archive 模块 */
async function getArchiveModule(): Promise<ArchiveModuleLike> {
  if (!archiveModulePromise) {
    archiveModulePromise = import('libarchive.js').then((mod) => {
      const { Archive } = mod as unknown as { Archive: ArchiveModuleLike };
      Archive.init({ workerUrl: `${import.meta.env.BASE_URL}libarchive/worker-bundle.js` });
      return Archive;
    });
  }
  return archiveModulePromise;
}

/** 打开压缩包读取器（调用方负责 close） */
export async function openArchiveReader(buffer: ArrayBuffer, fileName: string): Promise<ArchiveReaderLike> {
  const Archive = await getArchiveModule();
  return Archive.open(new File([buffer], fileName));
}

/** libarchive 条目数组 → 归一化条目信息（跳过空目录占位） */
export function toEntryInfos(list: Array<{ file: CompressedFileLike | string; path: string }>): ArchiveEntryInfo[] {
  const out: ArchiveEntryInfo[] = [];
  for (const item of list) {
    if (typeof item.file === 'string') continue; // 空目录占位
    const dir = item.path ?? '';
    const name = item.file.name;
    out.push({ innerPath: `${dir}${name}`, dir, name, size: item.file.size, cf: item.file });
  }
  return out;
}

/** 文件名（压缩包名），用于构造 File 传给 libarchive */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? 'archive';
}

/**
 * 按「外层压缩包路径 + 内层条目路径」提取条目字节。
 * 用于压缩包内层标签页在页面刷新后自动恢复：重新读取外层压缩包 → 定位条目 → 提取。
 * 外层字节复用 fetcher 的 LRU 缓存；读取器用完即关，不常驻。
 */
export async function extractArchiveEntryByPath(archivePath: string, innerPath: string): Promise<ArrayBuffer> {
  const buffer = await fetchFileBuffer(archivePath);
  const reader = await openArchiveReader(buffer, baseName(archivePath));
  try {
    const entries = toEntryInfos(await reader.getFilesArray());
    const hit = entries.find((e) => e.innerPath === innerPath);
    if (!hit) throw new Error(`archive entry not found: ${innerPath}`);
    const file = await hit.cf.extract();
    return await file.arrayBuffer();
  } finally {
    void reader.close().catch(() => undefined);
  }
}