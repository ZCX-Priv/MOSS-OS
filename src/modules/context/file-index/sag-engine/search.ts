// src/modules/context/file-index/sag-engine/search.ts
// SAG 检索：种子召回（查询实体归一化匹配 + FTS5 BM25 双路）→
// SQL JOIN 动态超边展开（共享实体的 events）→ 加权重排 → top-k。

import type { SagSearchResult } from '../types';
import type { SagStore } from './store';

const DEFAULT_TOP_K = 12;

/**
 * SAG 检索入口。
 * @param query 自然语言查询（分词后做实体匹配与全文召回）
 */
export function sagSearch(store: SagStore, query: string, topK = DEFAULT_TOP_K): SagSearchResult[] {
  const trimmed = query.trim();
  if (trimmed === '') return [];

  // 1) 种子事件：实体名匹配（查询词与 entities 归一化碰撞）+ FTS5 内容召回
  const terms = extractQueryTerms(trimmed);
  const seedEventIds = new Set<number>();
  const chunkScores = new Map<number, number>();

  for (const eid of seedEventsFromEntities(store, terms)) seedEventIds.add(eid);
  for (const { chunkId, score } of store.searchChunkIds(trimmed, topK * 2)) {
    chunkScores.set(chunkId, score);
    const evs = store.eventsByChunkIds([chunkId]);
    for (const e of evs) seedEventIds.add(e.id);
  }

  if (seedEventIds.size === 0) return [];

  // 2) 动态超边展开：种子事件关联实体 → 共享这些实体的其他事件
  const expanded = store.expandHyperedge([...seedEventIds], topK * 2);

  // 3) 合并候选并计分
  const candidates = new Map<number, number>();
  for (const eid of seedEventIds) candidates.set(eid, 10); // 种子基础分
  for (const { eventId, sharedEntities } of expanded) {
    candidates.set(eventId, (candidates.get(eventId) ?? 0) + sharedEntities * 3); // 超边共享加权
  }

  // 4) 事件 → chunk + 摘要，按分排序取 top-k
  const sorted = [...candidates.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK);
  const results: SagSearchResult[] = [];
  for (const [eventId, score] of sorted) {
    const events = store.eventsByIds([eventId]);
    const ev = events[0];
    if (!ev) continue;
    const chunk = store.chunkById(ev.chunk_id);
    if (!chunk) continue;
    const chunkBoost = chunkScores.get(ev.chunk_id) ?? 0;
    results.push({
      chunkId: ev.chunk_id,
      file: chunk.rel,
      startLine: chunk.start_line,
      endLine: chunk.end_line,
      summary: ev.summary,
      score: score + chunkBoost,
      matchedEntities: store.entityNamesByEvent(eventId).slice(0, 6),
    });
  }
  return results.sort((a, b) => b.score - a.score);
}

/** 种子事件（实体归一化匹配路径） */
function seedEventsFromEntities(store: SagStore, terms: string[]): number[] {
  const entityIds = store.entityIdsByNames(terms);
  if (entityIds.length === 0) return [];
  return store.eventIdsByEntityIds(entityIds, 50);
}

/** 查询分词：空白/标点切分 + 驼峰拆词（中文按 2-4 字滑窗） */
export function extractQueryTerms(query: string): string[] {
  const out = new Set<string>();
  // 英文标识符与词
  for (const m of query.matchAll(/[A-Za-z_$][A-Za-z0-9_$]{1,}/g)) {
    out.add(m[0]);
    // 驼峰拆词（FOOBar → FOO Bar）
    const parts = m[0].replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/\s+/);
    for (const p of parts) if (p.length >= 3) out.add(p);
  }
  // 中文词组（2-4 字组合，粗粒度）
  const chinese = query.match(/[\u4e00-\u9fa5]{2,8}/g) ?? [];
  for (const phrase of chinese) {
    out.add(phrase);
    if (phrase.length > 2) out.add(phrase.slice(0, 2));
  }
  return [...out].filter(t => t.length >= 2).slice(0, 16);
}
