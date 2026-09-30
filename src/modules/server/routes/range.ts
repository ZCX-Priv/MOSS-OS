// modules/server/routes/range.ts
// HTTP Range 头解析（纯函数，无副作用，便于单测）。
// 仅支持单区间：bytes=start-end / bytes=start- / bytes=-suffix。
// 返回 null 表示「无法解析 / 不适用」——调用方回退为完整响应（200），符合 RFC 7233 的宽松处理。

export interface ByteRange {
  /** 起始偏移（含） */
  start: number;
  /** 结束偏移（含） */
  end: number;
}

/**
 * 解析 Range 头。
 * @param header `Range` 头原始值（可能为 undefined）
 * @param size 文件总字节数（必须 > 0；0 字节文件统一按完整响应处理）
 */
export function parseRangeHeader(header: string | undefined, size: number): ByteRange | null {
  if (!header) return null;
  if (size <= 0) return null;

  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;

  const startStr = m[1];
  const endStr = m[2];

  // 后缀区间：最后 N 字节
  if (startStr === '' && endStr === '') return null;
  if (startStr === '') {
    const suffix = Number(endStr);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startStr);
  if (!Number.isInteger(start) || start < 0 || start >= size) return null;

  const end = endStr === '' ? size - 1 : Math.min(Number(endStr), size - 1);
  if (!Number.isInteger(end) || end < start) return null;

  return { start, end };
}

/**
 * 夹紧区间长度到 maxBytes 内。
 * RFC 7233 允许服务端返回「少于请求量」的 206；浏览器/播放器会据此继续发起后续
 * Range 请求，故单次响应内存有界，且不破坏拖动进度语义。
 */
export function clampChunk(range: ByteRange, maxBytes: number): ByteRange {
  return { start: range.start, end: Math.min(range.end, range.start + maxBytes - 1) };
}