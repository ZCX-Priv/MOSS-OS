// webui/src/lib/virtual-list/prefix.ts
// 虚拟列表的高度前缀和与区间查找（纯函数，独立成模块以便单测）。
//
// 模型：items[0..n) 逐条有高度 h[i]（实测或估算）。
// prefix 长度 n+1，prefix[0]=0，prefix[i+1]=prefix[i]+h[i]：
//   - 第 i 条消息占据滚动内容的 [prefix[i], prefix[i+1]) 像素区间；
//   - 内容总高 = prefix[n]。
// 可视区间 [start, end) 由 scrollTop / viewport 高度二分求得。

/** 由逐条高度构建前缀和（长度 n+1）。 */
export function buildPrefixSum(heights: readonly number[]): number[] {
  const n = heights.length;
  const prefix = new Array<number>(n + 1);
  prefix[0] = 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += heights[i];
    prefix[i + 1] = acc;
  }
  return prefix;
}

/**
 * 二分查找：最大的 i 使 prefix[i] <= offset。
 * 即「内容偏移 offset 落在第 i 条消息内」（i ∈ [0, n-1]；offset 超出总高时返回 n-1）。
 * 空列表返回 0。
 */
export function findItemAt(prefix: readonly number[], offset: number): number {
  const n = prefix.length - 1;
  if (n <= 0) return 0;
  let lo = 0;
  let hi = n - 1;
  const clamped = Math.max(0, offset);
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (prefix[mid] <= clamped) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * 计算需要渲染的消息下标区间 [start, end)。
 * - start：从「scrollTop - overscan」处所属消息开始；
 * - end：到覆盖「scrollTop + viewport + overscan」的最后一条消息（含）的下一个下标；
 * 结果夹在 [0, n]。
 */
export function computeRange(
  prefix: readonly number[],
  scrollTop: number,
  viewport: number,
  overscan: number,
): { start: number; end: number } {
  const n = prefix.length - 1;
  if (n <= 0) return { start: 0, end: 0 };
  const start = findItemAt(prefix, scrollTop - overscan);
  const lastVisible = findItemAt(prefix, scrollTop + viewport + overscan);
  return { start, end: Math.min(n, lastVisible + 1) };
}

/** 总内容高度。 */
export function totalHeight(prefix: readonly number[]): number {
  return prefix[prefix.length - 1] ?? 0;
}
