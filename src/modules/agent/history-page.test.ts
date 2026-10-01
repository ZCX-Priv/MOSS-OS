// src/modules/agent/history-page.test.ts
// 历史分页切片边界单测：首屏最新 N 条 / 上滑更早 / 尾部补齐 / 边界（0、整除、越界、空会话）

import { describe, it, expect } from 'bun:test';
import { computeHistorySlice, describeSlice } from './history-page';

describe('computeHistorySlice', () => {
  it('无 limit → 全量', () => {
    expect(computeHistorySlice(100)).toEqual({ start: 0, end: 100 });
    expect(computeHistorySlice(0)).toEqual({ start: 0, end: 0 });
  });

  it('limit only → 最新 limit 条（首屏）', () => {
    expect(computeHistorySlice(100, { limit: 30 })).toEqual({ start: 70, end: 100 });
  });

  it('总量小于 limit → 从 0 开始，不越界', () => {
    expect(computeHistorySlice(5, { limit: 30 })).toEqual({ start: 0, end: 5 });
  });

  it('limit + before → before 之前靠后的 limit 条（上滑加载更早）', () => {
    expect(computeHistorySlice(100, { limit: 30, before: 70 })).toEqual({ start: 40, end: 70 });
  });

  it('before 恰好等于 limit → 加载到头部，start 归零', () => {
    expect(computeHistorySlice(100, { limit: 30, before: 30 })).toEqual({ start: 0, end: 30 });
    expect(describeSlice(100, { start: 0, end: 30 }).hasMoreBefore).toBe(false);
  });

  it('before 小于 limit（头部页）→ 不出现负起点', () => {
    expect(computeHistorySlice(100, { limit: 30, before: 10 })).toEqual({ start: 0, end: 10 });
  });

  it('before 越界（大于总量）→ 收敛到 total', () => {
    expect(computeHistorySlice(100, { limit: 30, before: 999 })).toEqual({ start: 70, end: 100 });
  });

  it('limit + after → after 之后的尾部区间（断线/完成补齐）', () => {
    expect(computeHistorySlice(100, { limit: 30, after: 69 })).toEqual({ start: 70, end: 100 });
  });

  it('after 已是最后一条 → 空区间（无新消息）', () => {
    expect(computeHistorySlice(100, { limit: 30, after: 99 })).toEqual({ start: 100, end: 100 });
  });

  it('after 越界（大于总量）→ 收敛为空区间', () => {
    expect(computeHistorySlice(100, { limit: 30, after: 500 })).toEqual({ start: 100, end: 100 });
  });

  it('after 优先于 before（两者同时给出时以 after 为准）', () => {
    expect(computeHistorySlice(100, { limit: 10, after: 50, before: 20 })).toEqual({ start: 51, end: 61 });
  });

  it('非法 limit（0 / 负数 / NaN）按全量处理', () => {
    expect(computeHistorySlice(100, { limit: 0 })).toEqual({ start: 0, end: 100 });
    expect(computeHistorySlice(100, { limit: -5 })).toEqual({ start: 0, end: 100 });
    expect(computeHistorySlice(100, { limit: Number.NaN })).toEqual({ start: 0, end: 100 });
  });

  it('负 total 视为 0', () => {
    expect(computeHistorySlice(-3, { limit: 10 })).toEqual({ start: 0, end: 0 });
  });
});

describe('describeSlice', () => {
  it('空会话 newestIndex = -1（前端据此判断是否需要拉取）', () => {
    expect(describeSlice(0, { start: 0, end: 0 })).toEqual({
      oldestIndex: 0,
      newestIndex: -1,
      hasMoreBefore: false,
    });
  });

  it('首屏页元数据', () => {
    expect(describeSlice(100, { start: 70, end: 100 })).toEqual({
      oldestIndex: 70,
      newestIndex: 99,
      hasMoreBefore: true,
    });
  });

  it('after 补齐后的空区间：newestIndex 停在 after（表示无新消息）', () => {
    const meta = describeSlice(100, { start: 100, end: 100 });
    expect(meta.newestIndex).toBe(99);
    expect(meta.hasMoreBefore).toBe(true);
  });
});