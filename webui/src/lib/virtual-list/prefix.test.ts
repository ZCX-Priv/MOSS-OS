// webui/src/lib/virtual-list/prefix.test.ts
// 虚拟列表高度前缀和与区间查找的边界单测。
// 运行：bun test webui/src/lib/virtual-list/prefix.test.ts

import { describe, it, expect } from 'bun:test';
import { buildPrefixSum, findItemAt, computeRange, totalHeight } from './prefix';

describe('buildPrefixSum', () => {
  it('空列表 → [0]', () => {
    expect(buildPrefixSum([])).toEqual([0]);
  });

  it('常规：prefix[i+1] = prefix[i] + h[i]', () => {
    expect(buildPrefixSum([100, 200, 50])).toEqual([0, 100, 300, 350]);
  });
});

describe('findItemAt（内容偏移 → 所属条目下标）', () => {
  const prefix = buildPrefixSum([100, 200, 50]); // 条目区间：[0,100) [100,300) [300,350)

  it('offset 0 / 99 → 第 0 条', () => {
    expect(findItemAt(prefix, 0)).toBe(0);
    expect(findItemAt(prefix, 99)).toBe(0);
  });

  it('offset 100 / 299 → 第 1 条（边界归后条）', () => {
    expect(findItemAt(prefix, 100)).toBe(1);
    expect(findItemAt(prefix, 299)).toBe(1);
  });

  it('offset 300 → 第 2 条（最后一条）', () => {
    expect(findItemAt(prefix, 300)).toBe(2);
  });

  it('offset 超出总高 → 夹到 n-1（最后一条）', () => {
    expect(findItemAt(prefix, 10_000)).toBe(2);
  });

  it('负 offset → 0（防御）', () => {
    expect(findItemAt(prefix, -50)).toBe(0);
  });

  it('空列表 → 0', () => {
    expect(findItemAt([0], 0)).toBe(0);
  });
});

describe('computeRange（可视区间）', () => {
  const prefix = buildPrefixSum([100, 200, 50, 80]); // 总高 430
  it('scrollTop=0 + 大视口/overscan → 全部渲染', () => {
    const r = computeRange(prefix, 0, 500, 600);
    expect(r).toEqual({ start: 0, end: 4 });
  });

  it('中间视口：只渲染覆盖到的条目 ± overscan', () => {
    // scrollTop=100（第 1 条起点），viewport=100（到 200），overscan=0 → 只含第 1 条
    const r = computeRange(prefix, 100, 100, 0);
    expect(r).toEqual({ start: 1, end: 2 });
  });

  it('overscan 向上扩展覆盖前一条', () => {
    // scrollTop=150，viewport=50，overscan=100 → 起点 50（第 0 条），终点 300（第 2 条起点，归后条）
    const r = computeRange(prefix, 150, 50, 100);
    expect(r.start).toBe(0);
    expect(r.end).toBe(3);
  });

  it('scrollTop 超出总高（异常防御）→ 末条', () => {
    const r = computeRange(prefix, 10_000, 100, 0);
    expect(r.start).toBe(3);
    expect(r.end).toBe(4);
  });

  it('空列表 → [0,0)', () => {
    expect(computeRange([0], 0, 100, 50)).toEqual({ start: 0, end: 0 });
  });
});

describe('totalHeight', () => {
  it('空 → 0；常规 → 末元素', () => {
    expect(totalHeight([0])).toBe(0);
    expect(totalHeight(buildPrefixSum([100, 200]))).toBe(300);
  });
});
