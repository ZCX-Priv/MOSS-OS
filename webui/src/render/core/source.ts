// render/core/source.ts
// 预览内容源抽象：让渲染器既能消费「后端磁盘路径」，也能消费「内存中的字节/文本」。
// 用途：压缩包内层文件预览（无磁盘路径）、以及未来任何非落盘内容。
// 设计原则：FilePreviewPane 负责「取源」，渲染器组件本身仍只接收 buffer/text/objectUrl，
// 因此新增源类型不会扩散到各渲染器。

/** 磁盘路径源（走 filesys 权限 + /raw、/media、/text 后端通道） */
export interface PathPreviewSource {
  kind: 'path';
  /** 绝对路径（后端 filesys.resolve 校验） */
  path: string;
  /** 展示用文件名 */
  name: string;
}

/** 内存源（压缩包内层条目等；不触达后端） */
export interface MemoryPreviewSource {
  kind: 'memory';
  /** 展示用文件名（含扩展名，用于 kind 检测与语言高亮） */
  name: string;
  /** 二进制内容（与 text 二选一，取决于 kind；大型二进制优先） */
  buffer?: ArrayBuffer;
  /** 文本内容（文本类条目本地解码后） */
  text?: string;
  /** 显式 MIME（缺省按扩展名推断） */
  mime?: string;
}

/** 压缩包内层条目源（可持久化：仅记录外层路径 + 内层条目路径，内容按需重新提取） */
export interface ArchiveEntryPreviewSource {
  kind: 'archive-entry';
  /** 外层压缩包绝对路径 */
  archivePath: string;
  /** 内层条目路径（相对压缩包根，含子目录，'/' 分隔） */
  innerPath: string;
  /** 展示用条目文件名 */
  name: string;
}

export type PreviewSource = PathPreviewSource | MemoryPreviewSource | ArchiveEntryPreviewSource;

/** 由路径构造磁盘源 */
export function pathSource(path: string, name?: string): PathPreviewSource {
  return { kind: 'path', path, name: name ?? fileName(path) };
}

/** 构造压缩包内层条目源 */
export function archiveEntrySource(entry: {
  archivePath: string;
  innerPath: string;
  name: string;
}): ArchiveEntryPreviewSource {
  return { kind: 'archive-entry', ...entry };
}

/** 构造内存源 */
export function memorySource(input: {
  name: string;
  buffer?: ArrayBuffer;
  text?: string;
  mime?: string;
}): MemoryPreviewSource {
  return {
    kind: 'memory',
    name: input.name,
    buffer: input.buffer,
    text: input.text,
    mime: input.mime,
  };
}

/** 跨平台取文件名 */
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** 源文件名（kind 检测、标题展示的统一入口） */
export function nameOfSource(source: PreviewSource): string {
  return source.kind === 'path' ? fileName(source.path) : source.name;
}

/** 源扩展名（小写、无点） */
export function extOfSource(source: PreviewSource): string {
  const name = nameOfSource(source);
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}