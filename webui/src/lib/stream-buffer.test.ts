// webui/src/lib/stream-buffer.test.ts
// offset 续传核心纯函数单测：去重（重放）/ 正常续接（刷新后接流）/ 缺口自检 / 无 offset 兼容。
// 运行：bun test webui/src/lib/stream-buffer.test.ts（或根目录 npm test）

import { describe, it, expect } from 'bun:test';
import { nextChunkSlice } from './stream-buffer';

describe('nextChunkSlice', () => {
  it('新消息首片（offset 0，当前长度 0）→ 整段追加', () => {
    expect(nextChunkSlice(0, 0, '你好')).toEqual({ slice: '你好', resync: false });
  });

  it('连续续写 → 整段追加', () => {
    expect(nextChunkSlice(2, 2, '世界')).toEqual({ slice: '世界', resync: false });
  });

  it('重复分片（完全落在已知区间内）→ 丢弃，不重复追加', () => {
    expect(nextChunkSlice(6, 2, '世界')).toEqual({ slice: '', resync: false });
  });

  it('部分重叠（重连重放的典型形态）→ 只追加未收到的尾部', () => {
    // 已知 4 个字符，分片覆盖 [2,6) → 只应追加后 2 个字符
    expect(nextChunkSlice(4, 2, 'cdef')).toEqual({ slice: 'ef', resync: false });
  });

  it('缺口（offset 大于已知长度）→ 要求重新对齐', () => {
    expect(nextChunkSlice(2, 5, 'xyz')).toEqual({ slice: '', resync: true });
  });

  it('无 offset（旧后端 / 非流式来源）→ 退化为尾部追加', () => {
    expect(nextChunkSlice(123, undefined, 'abc')).toEqual({ slice: 'abc', resync: false });
  });

  it('空文本 → 什么都不做', () => {
    expect(nextChunkSlice(0, 0, '')).toEqual({ slice: '', resync: false });
  });

  it('刷新恢复场景：草稿长度作为已知长度，后续分片精确接上（不重不漏）', () => {
    const draft = '前半段回复'; // 服务端草稿内容
    const full = '前半段回复后半段回复'; // 该轮完整内容
    const rest = full.slice(draft.length);
    expect(nextChunkSlice(draft.length, draft.length, rest)).toEqual({ slice: rest, resync: false });
    // 若同一个分片被重复投递（重连重放）→ 第二次判定为重复
    expect(nextChunkSlice(full.length, draft.length, rest)).toEqual({ slice: '', resync: false });
  });

  it('草稿落后于服务端（分片起点在草稿长度之前）→ 只补差额', () => {
    const draftLen = 10;
    // 分片 [4, 14) 到达：应只追加第 10~13 这 4 个字符
    expect(nextChunkSlice(draftLen, 4, 'x'.repeat(10))).toEqual({
      slice: 'x'.repeat(4),
      resync: false,
    });
  });
});