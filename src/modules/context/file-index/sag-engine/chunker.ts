// src/modules/context/file-index/sag-engine/chunker.ts
// chunk 化策略：
//   代码文件 → 图谱可用时按顶层符号行范围切块（语义完整），否则 80 行固定块
//   文档/其他文本 → 80 行固定块
//   >512KB 或 <5 行跳过（不值得索引）

export interface RawChunk {
  startLine: number;
  endLine: number;
  content: string;
}

const CHUNK_LINES = 80;
const MAX_BYTES = 512 * 1024;
const MIN_LINES = 5;

/** 代码扩展名（用于判定走符号块还是行块） */
const CODE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.go', '.rs', '.java', '.rb', '.php', '.lua',
  '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.cs', '.swift',
]);

export function isCodeExt(ext: string): boolean {
  return CODE_EXTS.has(ext);
}

/**
 * 固定行块切分（含尾部不足一块的剩余）。
 */
export function chunkByLines(lines: string[]): RawChunk[] {
  const out: RawChunk[] = [];
  for (let i = 0; i < lines.length; i += CHUNK_LINES) {
    const slice = lines.slice(i, i + CHUNK_LINES);
    out.push({
      startLine: i + 1,
      endLine: i + slice.length,
      content: slice.join('\n'),
    });
  }
  return out;
}

/**
 * 按符号行范围切块（图谱符号表驱动）：每个顶层符号一块，
 * 首个符号前的头部空隙并入首块，符号间空隙归入前一块（全覆盖不留洞）。
 */
export function chunkBySymbols(
  lines: string[],
  symbols: Array<{ line: number; endLine: number }>,
): RawChunk[] {
  if (symbols.length === 0) return chunkByLines(lines);
  // 过滤无效范围并按起始行排序
  const valid = symbols
    .filter(s => s.line >= 1 && s.endLine >= s.line && s.line <= lines.length)
    .sort((a, b) => a.line - b.line);

  const out: RawChunk[] = [];
  let cursor = 1; // 1-based 当前行
  for (const sym of valid) {
    const start = Math.max(sym.line, cursor);
    if (start > lines.length) break;
    const end = Math.min(sym.endLine, lines.length);
    if (end < start) continue;
    // 符号前的空隙并入前一块；首个符号前的头部空隙并入首符号块（文件头注释归属首个符号）
    if (start > cursor) {
      const gap = lines.slice(cursor - 1, start - 1).join('\n');
      if (gap.trim() !== '') {
        if (out.length > 0) {
          const prev = out[out.length - 1];
          prev.content += `\n${gap}`;
          prev.endLine = start - 1;
        } else {
          // 头部空隙：合并进即将创建的符号块
          const content = `${gap}\n${lines.slice(start - 1, end).join('\n')}`;
          out.push({ startLine: cursor, endLine: end, content });
          cursor = end + 1;
          continue;
        }
      }
    }
    const content = lines.slice(start - 1, end).join('\n');
    out.push({ startLine: start, endLine: end, content });
    cursor = end + 1;
  }
  // 尾部剩余
  if (cursor <= lines.length) {
    const tail = lines.slice(cursor - 1).join('\n');
    if (tail.trim() !== '') {
      out.push({ startLine: cursor, endLine: lines.length, content: tail });
    }
  }
  return out;
}

/**
 * 文本内容切块入口。
 * @returns null = 跳过（过大/过小）
 */
export function chunkText(
  source: string,
  isCode: boolean,
  symbols: Array<{ line: number; endLine: number }> | null,
): RawChunk[] | null {
  if (source.length > MAX_BYTES) return null;
  const lines = source.split('\n');
  if (lines.length < MIN_LINES) return null;
  if (isCode && symbols && symbols.length > 0) {
    return chunkBySymbols(lines, symbols);
  }
  return chunkByLines(lines);
}

/** chunk 摘要（规则版，LLM 抽取前的占位 event）：首行非空行截断 */
export function ruleSummary(chunk: RawChunk, isCode: boolean): string {
  const firstMeaningful = chunk.content
    .split('\n')
    .map(l => l.trim())
    .find(l => l !== '' && !l.startsWith('//') && !l.startsWith('#!'));
  if (!firstMeaningful) return `L${chunk.startLine}-${chunk.endLine}`;
  const prefix = isCode ? '' : '';
  return `${prefix}${firstMeaningful.slice(0, 120)}`;
}
