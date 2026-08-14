// read/shared/minified.ts
// minified 文件检测：通过平均行长判断是否为压缩/混淆文件。
// minified 文件（如 min.js、bundle.js）单行可达几十万字符，
// 全量返回会破坏 LLM 解析并浪费上下文，故检测到后截断每行并提示。

/** 平均行长阈值：超过 500 字符/行视为 minified */
const AVG_LINE_THRESHOLD = 500;

/** 单行截断阈值：minified 文件中每行最多保留 2000 字符 */
const MAX_LINE_LENGTH = 2000;

/** minified 检测结果 */
export interface MinifiedResult {
  /** 是否为 minified 文件 */
  isMinified: boolean;
  /** 平均行长（字符数） */
  avgLineLength: number;
}

/**
 * 检测内容是否为 minified 文件。
 * 算法：平均行长 = 总字符数 / 行数，超过阈值视为 minified。
 */
export function detectMinified(content: string): MinifiedResult {
  const lines = content.split('\n');
  if (lines.length === 0) return { isMinified: false, avgLineLength: 0 };
  const totalLen = content.length;
  const avg = totalLen / lines.length;
  return { isMinified: avg > AVG_LINE_THRESHOLD, avgLineLength: avg };
}

/** 截断结果 */
export interface TruncateResult {
  /** 截断后的文本 */
  text: string;
  /** 是否发生了截断 */
  truncated: boolean;
}

/**
 * 截断 minified 文件中超长行。
 * 仅在 detectMinified 返回 isMinified:true 时调用：
 * 每行超过 MAX_LINE_LENGTH 字符则截断并追加提示标记。
 */
export function truncateMinifiedLines(text: string): TruncateResult {
  const lines = text.split('\n');
  let truncated = false;
  const out = lines.map((line) => {
    if (line.length > MAX_LINE_LENGTH) {
      truncated = true;
      return line.slice(0, MAX_LINE_LENGTH) + ' ...truncated (use grep for full content)';
    }
    return line;
  });
  return { text: out.join('\n'), truncated };
}
