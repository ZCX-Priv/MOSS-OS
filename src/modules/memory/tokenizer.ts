// src/modules/memory/tokenizer.ts
// 中文友好分词器：CJK 字符 bigram + ASCII 词级。
// BM25 检索的输入单元——中文单字区分度低，bigram 在无词典条件下召回效果最佳；
// 英文/数字按词切分并小写化。

/** 判断是否为 CJK 字符（含扩展 A 区与常用汉字区间） */
function isCJK(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff)
  );
}

/**
 * 分词：CJK bigram + ASCII 词级（小写化）。
 * 示例："上下文引擎 context" → ["上下","下文","引擎","context"]
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const cleaned = text.replace(/\s+/g, ' ');
  let asciiBuf = '';

  const flushAscii = (): void => {
    if (asciiBuf !== '') {
      tokens.push(asciiBuf.toLowerCase());
      asciiBuf = '';
    }
  };

  const chars = [...cleaned];
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].codePointAt(0) ?? 0;
    if (isCJK(code)) {
      flushAscii();
      if (i + 1 < chars.length) {
        // CJK bigram：当前字 + 下一字
        const next = chars[i + 1].codePointAt(0) ?? 0;
        if (isCJK(next)) {
          tokens.push(chars[i] + chars[i + 1]);
        } else {
          tokens.push(chars[i]);
        }
      } else if (i === 0 || !isCJK(chars[i - 1].codePointAt(0) ?? 0)) {
        // 尾字且未包含于前一 bigram（前一字符非 CJK）才单独输出
        tokens.push(chars[i]);
      }
      // 否则：尾字已作为前一 bigram 的右元，跳过（避免重复 token）
    } else if (/[a-zA-Z0-9_]/.test(chars[i])) {
      asciiBuf += chars[i];
    } else {
      flushAscii();
    }
  }
  flushAscii();
  return tokens;
}

/** token 集合重合度（Jaccard；合并策略的"语义相近"判定） */
export function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const x of setA) {
    if (setB.has(x)) inter++;
  }
  return inter / (setA.size + setB.size - inter);
}
