// src/modules/context/file-index/sag-engine/store.ts
// SAG SQLite 存储（Event-Entity 模型）：
//   chunks（原文块）/ events（事件摘要）/ entities（实体）/ event_entities（超边关联）
//   + FTS5（chunks.content / events.summary 双全文索引；FTS5 不可用时 LIKE 降级）。

import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface SagChunkRow {
  id: number;
  rel: string;
  start_line: number;
  end_line: number;
  content: string;
}

export interface SagEventRow {
  id: number;
  chunk_id: number;
  summary: string;
  is_llm: number;
}

export interface SagEntityRow {
  id: number;
  name: string;
  type: string;
}

export class SagStore {
  private db: Database;
  private fts = false;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, 'sag.db'), { create: true });
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_key TEXT NOT NULL,
        rel TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        content TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_key);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id INTEGER NOT NULL,
        summary TEXT NOT NULL,
        is_llm INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_events_chunk ON events(chunk_id);
      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        norm_name TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        UNIQUE (norm_name, type)
      );
      CREATE TABLE IF NOT EXISTS event_entities (
        event_id INTEGER NOT NULL,
        entity_id INTEGER NOT NULL,
        PRIMARY KEY (event_id, entity_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ee_entity ON event_entities(entity_id);
    `);
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(content, chunk_id UNINDEXED);
        CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(summary, event_id UNINDEXED);
      `);
      this.fts = true;
    } catch {
      this.fts = false; // FTS5 不可用 → LIKE 降级
    }
  }

  close(): void {
    try {
      // checkpoint 收拢 WAL 文件句柄（Windows 下防句柄延迟锁目录）
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      this.db.close();
    } catch {
      // 忽略
    }
  }

  get hasFts(): boolean {
    return this.fts;
  }

  /** 事务内替换文件全部 chunk 数据（含关联 events/entities 清理） */
  replaceFileChunks(
    fileKey: string,
    rel: string,
    chunks: Array<{ startLine: number; endLine: number; content: string; summary: string; entities: Array<{ name: string; type: string }> }>,
  ): void {
    this.db.transaction(() => {
      this.removeFileInternal(fileKey);
      const insChunk = this.db.query(
        'INSERT INTO chunks (file_key, rel, start_line, end_line, content) VALUES (?, ?, ?, ?, ?)',
      );
      const insEvent = this.db.query('INSERT INTO events (chunk_id, summary, is_llm) VALUES (?, ?, 0)');
      const insFtsChunk = this.fts ? this.db.query('INSERT INTO chunks_fts (content, chunk_id) VALUES (?, ?)') : null;
      const insFtsEvent = this.fts ? this.db.query('INSERT INTO events_fts (summary, event_id) VALUES (?, ?)') : null;
      for (const c of chunks) {
        const r = insChunk.run(fileKey, rel, c.startLine, c.endLine, c.content);
        const chunkId = Number(r.lastInsertRowid);
        const er = insEvent.run(chunkId, c.summary);
        const eventId = Number(er.lastInsertRowid);
        insFtsChunk?.run(c.content, chunkId);
        insFtsEvent?.run(c.summary, eventId);
        for (const ent of c.entities) {
          const entityId = this.ensureEntity(ent.name, ent.type);
          this.db
            .query('INSERT OR IGNORE INTO event_entities (event_id, entity_id) VALUES (?, ?)')
            .run(eventId, entityId);
        }
      }
    })();
  }

  /** 实体注册（已存在则复用 id） */
  private ensureEntity(name: string, type: string): number {
    const norm = normalizeEntityName(name);
    const existing = this.db
      .query<{ id: number }, SQLQueryBindings[]>('SELECT id FROM entities WHERE norm_name = ? AND type = ?')
      .get(norm, type);
    if (existing) return existing.id;
    const r = this.db.query('INSERT OR IGNORE INTO entities (norm_name, name, type) VALUES (?, ?, ?)').run(norm, name, type);
    if (Number(r.changes) > 0) return Number(r.lastInsertRowid);
    // 并发竞态（同事务内重复）：重新查询
    const again = this.db
      .query<{ id: number }, SQLQueryBindings[]>('SELECT id FROM entities WHERE norm_name = ? AND type = ?')
      .get(norm, type);
    return again ? again.id : Number(r.lastInsertRowid);
  }

  private removeFileInternal(fileKey: string): void {
    const chunkIds = this.db
      .query<{ id: number }, SQLQueryBindings[]>('SELECT id FROM chunks WHERE file_key = ?')
      .all(fileKey)
      .map(r => r.id);
    for (const cid of chunkIds) this.deleteChunkInternal(cid);
    this.db.query('DELETE FROM chunks WHERE file_key = ?').run(fileKey);
  }

  private deleteChunkInternal(chunkId: number): void {
    const eventIds = this.db
      .query<{ id: number }, SQLQueryBindings[]>('SELECT id FROM events WHERE chunk_id = ?')
      .all(chunkId)
      .map(r => r.id);
    for (const eid of eventIds) {
      this.db.query('DELETE FROM event_entities WHERE event_id = ?').run(eid);
    }
    this.db.query('DELETE FROM events WHERE chunk_id = ?').run(chunkId);
    this.db.query('DELETE FROM chunks WHERE id = ?').run(chunkId);
    if (this.fts) {
      this.db.query('DELETE FROM chunks_fts WHERE chunk_id = ?').run(chunkId);
      for (const eid of eventIds) {
        this.db.query('DELETE FROM events_fts WHERE event_id = ?').run(eid);
      }
    }
  }

  removeFile(fileKey: string): void {
    this.db.transaction(() => this.removeFileInternal(fileKey))();
  }

  // ==========================================================================
  // 查询
  // ==========================================================================

  /** 实体归一化名 → 实体 id 批查（种子召回） */
  entityIdsByNames(names: string[]): number[] {
    const out: number[] = [];
    for (const n of names) {
      const rows = this.db
        .query<{ id: number }, SQLQueryBindings[]>('SELECT id FROM entities WHERE norm_name = ?')
        .all(normalizeEntityName(n));
      for (const r of rows) out.push(r.id);
    }
    return out;
  }

  /** 实体 id → 关联事件 id（种子事件） */
  eventIdsByEntityIds(entityIds: number[], limit: number): number[] {
    if (entityIds.length === 0) return [];
    const placeholders = entityIds.map(() => '?').join(',');
    return this.db
      .query<{ event_id: number }, SQLQueryBindings[]>(
        `SELECT DISTINCT event_id FROM event_entities WHERE entity_id IN (${placeholders}) LIMIT ?`,
      )
      .all(...entityIds, limit)
      .map(r => r.event_id);
  }

  /** FTS5 BM25 召回（chunks.content）；LIKE 降级 */
  searchChunkIds(query: string, limit: number): Array<{ chunkId: number; score: number }> {
    if (query.trim() === '') return [];
    if (this.fts) {
      try {
        const terms = query
          .split(/[\s,，。;；]+/)
          .filter(Boolean)
          .map(sanitizeFtsTerm)
          .filter(t => t.length > 0);
        if (terms.length === 0) return [];
        const match = terms.map(() => '?').join(' OR ');
        const rows = this.db
          .query<{ chunk_id: number; rank: number }, SQLQueryBindings[]>(
            `SELECT chunk_id, rank FROM chunks_fts WHERE chunks_fts MATCH ${match} ORDER BY rank LIMIT ?`,
          )
          .all(...terms, limit);
        return rows.map(r => ({ chunkId: r.chunk_id, score: -r.rank }));
      } catch {
        // MATCH 语法异常 → LIKE 降级
      }
    }
    // LIKE 降级
    const escaped = query.replace(/[\\%_]/g, m => `\\${m}`);
    const rows = this.db
      .query<{ id: number }, SQLQueryBindings[]>('SELECT id FROM chunks WHERE content LIKE ? ESCAPE "\\" LIMIT ?')
      .all(`%${escaped}%`, limit);
    return rows.map(r => ({ chunkId: r.id, score: 1 }));
  }

  /**
   * SAG 动态超边核心查询：
   * 种子事件（seedEventIds）→ 关联实体 → 共享这些实体的其他事件（局部超边展开）。
   */
  expandHyperedge(seedEventIds: number[], limit: number): Array<{ eventId: number; sharedEntities: number }> {
    if (seedEventIds.length === 0) return [];
    const placeholders = seedEventIds.map(() => '?').join(',');
    const rows = this.db
      .query<{ event_id: number; shared: number }, SQLQueryBindings[]>(
        `SELECT ee.event_id, COUNT(DISTINCT ee.entity_id) AS shared
         FROM event_entities ee
         WHERE ee.entity_id IN (
           SELECT entity_id FROM event_entities WHERE event_id IN (${placeholders})
         ) AND ee.event_id NOT IN (${placeholders})
         GROUP BY ee.event_id
         ORDER BY shared DESC
         LIMIT ?`,
      )
      .all(...seedEventIds, ...seedEventIds, limit);
    return rows.map(r => ({ eventId: r.event_id, sharedEntities: r.shared }));
  }

  /** 种子事件自身（按 chunk） */
  eventsByChunkIds(chunkIds: number[]): SagEventRow[] {
    if (chunkIds.length === 0) return [];
    const placeholders = chunkIds.map(() => '?').join(',');
    return this.db
      .query<SagEventRow, SQLQueryBindings[]>(`SELECT id, chunk_id, summary, is_llm FROM events WHERE chunk_id IN (${placeholders})`)
      .all(...chunkIds);
  }

  eventsByIds(eventIds: number[]): Array<SagEventRow> {
    if (eventIds.length === 0) return [];
    const placeholders = eventIds.map(() => '?').join(',');
    return this.db
      .query<SagEventRow, SQLQueryBindings[]>(`SELECT id, chunk_id, summary, is_llm FROM events WHERE id IN (${placeholders})`)
      .all(...eventIds);
  }

  /** 事件的命中实体名（渲染证据用） */
  entityNamesByEvent(eventId: number): string[] {
    return this.db
      .query<{ name: string }, SQLQueryBindings[]>(
        'SELECT e.name FROM entities e JOIN event_entities ee ON ee.entity_id = e.id WHERE ee.event_id = ?',
      )
      .all(eventId)
      .map(r => r.name);
  }

  chunkById(id: number): SagChunkRow | null {
    return this.db
      .query<SagChunkRow, SQLQueryBindings[]>('SELECT id, rel, start_line, end_line, content FROM chunks WHERE id = ?')
      .get(id) ?? null;
  }

  chunksByIds(ids: number[]): SagChunkRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db
      .query<SagChunkRow, SQLQueryBindings[]>(`SELECT id, rel, start_line, end_line, content FROM chunks WHERE id IN (${placeholders})`)
      .all(...ids);
  }

  /** 待 LLM 抽取的 chunk（规则 event 已有但未 LLM 增强；优先文档类） */
  pendingLlmChunkIds(limit: number): number[] {
    return this.db
      .query<{ chunk_id: number }, SQLQueryBindings[]>(
        `SELECT e.chunk_id FROM events e
         JOIN chunks c ON c.id = e.chunk_id
         WHERE e.is_llm = 0
         ORDER BY CASE WHEN c.rel LIKE '%.md%' THEN 0 ELSE 1 END, e.chunk_id
         LIMIT ?`,
      )
      .all(limit)
      .map(r => r.chunk_id);
  }

  /** LLM 抽取结果回写（替换规则 event） */
  writeLlmEvent(chunkId: number, summary: string, entities: Array<{ name: string; type: string }>): void {
    this.db.transaction(() => {
      const old = this.db
        .query<{ id: number }, SQLQueryBindings[]>('SELECT id FROM events WHERE chunk_id = ? AND is_llm = 0')
        .all(chunkId);
      for (const o of old) {
        this.db.query('DELETE FROM event_entities WHERE event_id = ?').run(o.id);
        this.db.query('DELETE FROM events WHERE id = ?').run(o.id);
        if (this.fts) this.db.query('DELETE FROM events_fts WHERE event_id = ?').run(o.id);
      }
      const r = this.db.query('INSERT INTO events (chunk_id, summary, is_llm) VALUES (?, ?, 1)').run(chunkId, summary);
      const eventId = Number(r.lastInsertRowid);
      if (this.fts) this.db.query('INSERT INTO events_fts (summary, event_id) VALUES (?, ?)').run(summary, eventId);
      for (const ent of entities) {
        const entityId = this.ensureEntity(ent.name, ent.type);
        this.db.query('INSERT OR IGNORE INTO event_entities (event_id, entity_id) VALUES (?, ?)').run(eventId, entityId);
      }
    })();
  }

  counts(): { chunkCount: number; eventCount: number; entityCount: number; llmExtracted: number } {
    const chunks = this.db.query<{ c: number }, SQLQueryBindings[]>('SELECT COUNT(*) AS c FROM chunks').get()!;
    const events = this.db.query<{ c: number }, SQLQueryBindings[]>('SELECT COUNT(*) AS c FROM events').get()!;
    const entities = this.db.query<{ c: number }, SQLQueryBindings[]>('SELECT COUNT(*) AS c FROM entities').get()!;
    const llm = this.db.query<{ c: number }, SQLQueryBindings[]>('SELECT COUNT(*) AS c FROM events WHERE is_llm = 1').get()!;
    return { chunkCount: chunks.c, eventCount: events.c, entityCount: entities.c, llmExtracted: llm.c };
  }

  /** 高频实体（项目概要"核心概念"用） */
  topEntities(limit: number): Array<{ name: string; type: string; refs: number }> {
    return this.db
      .query<{ name: string; type: string; refs: number }, SQLQueryBindings[]>(
        `SELECT e.name, e.type, COUNT(ee.event_id) AS refs
         FROM entities e JOIN event_entities ee ON ee.entity_id = e.id
         GROUP BY e.id ORDER BY refs DESC LIMIT ?`,
      )
      .all(limit);
  }

  clear(): void {
    this.db.transaction(() => {
      this.db.exec('DELETE FROM event_entities;');
      this.db.exec('DELETE FROM events;');
      this.db.exec('DELETE FROM entities;');
      this.db.exec('DELETE FROM chunks;');
      if (this.fts) {
        this.db.exec('DELETE FROM chunks_fts;');
        this.db.exec('DELETE FROM events_fts;');
      }
    })();
  }

  chunkedFileKeys(): Set<string> {
    return new Set(this.db.query<{ file_key: string }, SQLQueryBindings[]>('SELECT DISTINCT file_key FROM chunks').all().map(r => r.file_key));
  }

  chunkContent(chunkId: number): string | null {
    const r = this.db.query<{ content: string }, SQLQueryBindings[]>('SELECT content FROM chunks WHERE id = ?').get(chunkId);
    return r ? r.content : null;
  }
}

/** 实体名归一化：小写 + 去符号（驼峰/下划线不拆，保标识符完整性） */
export function normalizeEntityName(name: string): string {
  return name.trim().toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, '');
}

/** FTS5 MATCH 词安全化（去操作符语法字符，加引号短语） */
function sanitizeFtsTerm(term: string): string {
  const cleaned = term.replace(/["*()^:]/g, ' ').trim();
  if (cleaned === '') return '';
  return `"${cleaned}"`;
}
