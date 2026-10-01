// src/modules/agent/history-page.ts
// 会话历史分页切片计算（纯函数，独立成模块以便单测覆盖边界）。
//
// 游标语义：index = 「过滤软删除后的消息数组」下标。会话消息只在尾部追加，
// 截断/恢复也只影响尾部 → 头部下标天然稳定，before/after 游标不会错位。
//
// - 无 limit：全量（[0, total)）
// - limit：最新 limit 条
// - limit + before：index < before 的区间（取靠后 limit 条，上滑加载更早）
// - limit + after：index > after 的区间（尾部补齐，断线/完成恢复）

export interface HistorySliceOptions {
  limit?: number;
  before?: number;
  after?: number;
}

export interface HistorySlice {
  /** 闭开区间起点 */
  start: number;
  /** 闭开区间终点 */
  end: number;
}

export function computeHistorySlice(total: number, opts?: HistorySliceOptions): HistorySlice {
  const n = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const rawLimit = opts?.limit;
  const limit = typeof rawLimit === 'number' && rawLimit > 0 ? Math.floor(rawLimit) : undefined;
  if (limit === undefined) {
    return { start: 0, end: n };
  }
  const after = opts?.after;
  if (typeof after === 'number' && Number.isFinite(after)) {
    const start = Math.max(0, Math.min(n, Math.floor(after) + 1));
    return { start, end: Math.min(n, start + limit) };
  }
  const before = opts?.before;
  if (typeof before === 'number' && Number.isFinite(before)) {
    const end = Math.max(0, Math.min(n, Math.floor(before)));
    return { start: Math.max(0, end - limit), end };
  }
  // 首屏：最新 limit 条
  return { start: Math.max(0, n - limit), end: n };
}

/**
 * 分页视图的元数据（与前端 historyMeta 对齐）。
 * newestIndex 在空会话时为 -1（表示「尚无任何消息」，前端据此判断是否需要拉取）。
 */
export function describeSlice(total: number, slice: HistorySlice): {
  oldestIndex: number;
  newestIndex: number;
  hasMoreBefore: boolean;
} {
  const count = Math.max(0, slice.end - slice.start);
  return {
    oldestIndex: slice.start,
    newestIndex: total === 0 ? -1 : slice.start + count - 1,
    hasMoreBefore: slice.start > 0,
  };
}