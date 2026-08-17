// read/shared/streaming.ts
// 流式行读取：提供异步行迭代器，避免 content.split('\n') 一次性加载大文件到内存。
// 使用 createReadStream 按块读取，处理跨块换行，逐行 yield。
// 供 text handler 的全量模式处理大文本文件使用。

import { createReadStream } from 'node:fs';
import type { ReadStream } from 'node:fs';

/**
 * 流式逐行读取文件的异步生成器。
 * 不会一次性将整个文件加载到内存，适合处理较大文本文件。
 *
 * @param path 文件绝对路径
 * @param encoding 文件编码（默认 utf8）
 * @yields 每一行内容（不含换行符）
 */
export async function* readLinesStream(
  path: string,
  encoding: BufferEncoding = 'utf8',
): AsyncGenerator<string> {
  const stream: ReadStream = createReadStream(path, { encoding });
  let remainder = '';

  for await (const chunk of stream) {
    const data = remainder + (chunk as string);
    const lines = data.split('\n');
    // 最后一段可能不完整（不含换行符），留到下一块
    remainder = lines.pop() ?? '';
    for (const line of lines) {
      yield line;
    }
  }
  // 处理最后剩余的部分
  if (remainder.length > 0) {
    yield remainder;
  }
}

/**
 * 统计文件总行数（流式，不加载全文到内存）。
 * 用于全量模式前预估行号宽度。
 */
export async function countLines(path: string, encoding: BufferEncoding = 'utf8'): Promise<number> {
  let count = 0;
  for await (const _ of readLinesStream(path, encoding)) {
    count++;
  }
  return count;
}
