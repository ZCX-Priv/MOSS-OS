// src/modules/tools/sort.ts
// 工具名排序：字符序 A-Z → a-z → 0-9（大写字母 < 小写字母 < 数字），
// 其余字符（如 _ -）排在数字之后按码点比较；前缀更短者在前（短在前长在后）。

/** 单字符排序权重：A-Z=0..25, a-z=26..51, 0-9=52..61, 其他=62 */
function charRank(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;        // A-Z
  if (code >= 97 && code <= 122) return code - 97 + 26;  // a-z
  if (code >= 48 && code <= 57) return code - 48 + 52;   // 0-9
  return 62;                                             // 其他（_ - 等）
}

/** 工具名比较器（可直接传给 Array.prototype.sort） */
export function compareToolNames(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    const ra = charRank(ca);
    const rb = charRank(cb);
    if (ra !== rb) return ra - rb;
    if (ca !== cb) return ca - cb;
  }
  return a.length - b.length;
}