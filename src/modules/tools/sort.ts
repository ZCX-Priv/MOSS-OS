// src/modules/tools/sort.ts
// 工具名排序：先按首字母分组（A → Z → a → z → 0 → 9 → 其他，权重见 charRank）；
// 同一首字母组内按名称长度升序（短在前长在后）；
// 长度也相同时逐字符按 A-Z → a-z → 0-9 字符序（其余字符按码点）。

/** 单字符排序权重：A-Z=0..25, a-z=26..51, 0-9=52..61, 其他=62 */
function charRank(code: number): number {
  if (code >= 65 && code <= 90) return code - 65;        // A-Z
  if (code >= 97 && code <= 122) return code - 97 + 26;  // a-z
  if (code >= 48 && code <= 57) return code - 48 + 52;   // 0-9
  return 62;                                             // 其他（_ - 等）
}

/** 工具名比较器（可直接传给 Array.prototype.sort） */
export function compareToolNames(a: string, b: string): number {
  // 1) 首字母分组：A → Z → a → z → 0 → 9 → 其他
  const headA = charRank(a.charCodeAt(0));
  const headB = charRank(b.charCodeAt(0));
  if (headA !== headB) return headA - headB;
  // 2) 组内长度升序（短在前长在后）
  if (a.length !== b.length) return a.length - b.length;
  // 3) 组内同长度：逐字符字符序（i=0 在同一分组内仍需比较，保证"其他"分组的确定性）
  for (let i = 0; i < a.length; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    const ra = charRank(ca);
    const rb = charRank(cb);
    if (ra !== rb) return ra - rb;
    if (ca !== cb) return ca - cb;
  }
  return 0;
}