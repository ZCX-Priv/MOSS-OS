// src/modules/context/file-index/graph-engine/store.ts
// 图谱 SQLite 存储：files（已解析文件）/ symbols（符号定义）/ file_edges（import 图）。
// 符号名搜索用 LIKE（标识符短且无自然语言分词需求，优于 FTS5 分词）。

import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphImportEdge, GraphSymbol } from '../types';

export interface SymbolRow {
  file: string;
  name: string;
  kind: string;
  line: number;
  col: number;
  end_line: number;
  signature: string;
}

export class GraphStore {
  private db: Database;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, 'graph.db'), { create: true });
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path_key TEXT PRIMARY KEY,
        rel TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_key TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        line INTEGER NOT NULL,
        col INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        signature TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_key);
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE TABLE IF NOT EXISTS file_edges (
        src_key TEXT NOT NULL,
        dst_key TEXT NOT NULL,
        PRIMARY KEY (src_key, dst_key)
      );
      CREATE INDEX IF NOT EXISTS idx_edges_dst ON file_edges(dst_key);
    `);
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

  /** 事务内替换单文件全部数据（符号 + import 边） */
  replaceFile(pathKey: string, rel: string, symbols: GraphSymbol[], imports: GraphImportEdge[]): void {
    this.db.transaction(() => {
      this.removeFileInternal(pathKey);
      this.db.query('INSERT OR REPLACE INTO files (path_key, rel) VALUES (?, ?)').run(pathKey, rel);
      const insSym = this.db.query(
        'INSERT INTO symbols (file_key, name, kind, line, col, end_line, signature) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      for (const s of symbols) {
        insSym.run(pathKey, s.name, s.kind, s.line, s.col, s.endLine, s.signature);
      }
      const insEdge = this.db.query(
        'INSERT OR IGNORE INTO file_edges (src_key, dst_key) VALUES (?, ?)',
      );
      for (const e of imports) {
        insEdge.run(e.src.toLowerCase(), e.dst.toLowerCase());
      }
    })();
  }

  /** 删除文件（级联删符号与以其为源的边） */
  removeFile(pathKey: string): void {
    this.db.transaction(() => this.removeFileInternal(pathKey))();
  }

  private removeFileInternal(pathKey: string): void {
    this.db.query('DELETE FROM symbols WHERE file_key = ?').run(pathKey);
    // 只删该文件作为"源"的边（它 import 谁）；指向它的边（dst_key）属于上游文件的数据，
    // 由上游文件自己重解析时维护——此处误删会导致其他文件的依赖边在批量构建时丢失
    this.db.query('DELETE FROM file_edges WHERE src_key = ?').run(pathKey);
    this.db.query('DELETE FROM files WHERE path_key = ?').run(pathKey);
  }

  /** 谁 import 了我（上游，改动影响面；LEFT JOIN：未入库的 src 仍显示 pathKey） */
  upstream(dstKey: string): string[] {
    return this.db
      .query<{ rel: string }, SQLQueryBindings[]>(
        'SELECT COALESCE(f.rel, e.src_key) AS rel FROM file_edges e LEFT JOIN files f ON f.path_key = e.src_key WHERE e.dst_key = ? ORDER BY rel',
      )
      .all(dstKey.toLowerCase())
      .map(r => r.rel);
  }

  /** 我 import 了谁（下游依赖；LEFT JOIN：目标文件未解析入库时仍显示 pathKey） */
  downstream(srcKey: string): string[] {
    return this.db
      .query<{ rel: string }, SQLQueryBindings[]>(
        'SELECT COALESCE(f.rel, e.dst_key) AS rel FROM file_edges e LEFT JOIN files f ON f.path_key = e.dst_key WHERE e.src_key = ? ORDER BY rel',
      )
      .all(srcKey.toLowerCase())
      .map(r => r.rel);
  }

  /** 文件符号清单 */
  fileSymbols(pathKey: string): SymbolRow[] {
    return this.db
      .query<SymbolRow, SQLQueryBindings[]>(
        'SELECT f.rel AS file, s.name, s.kind, s.line, s.col, s.end_line, s.signature FROM symbols s JOIN files f ON f.path_key = s.file_key WHERE s.file_key = ? ORDER BY s.line',
      )
      .all(pathKey.toLowerCase());
  }

  /** 符号名搜索（子串匹配，LIKE 转义） */
  searchSymbols(name: string, limit: number): Array<SymbolRow & { file_key: string }> {
    const escaped = name.replace(/[\\%_]/g, m => `\\${m}`);
    return this.db
      .query<SymbolRow & { file_key: string }, SQLQueryBindings[]>(
        `SELECT s.file_key, f.rel AS file, s.name, s.kind, s.line, s.col, s.end_line, s.signature
         FROM symbols s JOIN files f ON f.path_key = s.file_key
         WHERE s.name LIKE ? ESCAPE '\\'
         ORDER BY LENGTH(s.name), s.name LIMIT ?`,
      )
      .all(`%${escaped}%`, limit);
  }

  /** 被依赖最多的文件（hub，项目结构概要用） */
  hubFiles(limit: number): Array<{ rel: string; importers: number }> {
    return this.db
      .query<{ rel: string; importers: number }, SQLQueryBindings[]>(
        `SELECT f.rel, COUNT(e.src_key) AS importers
         FROM file_edges e JOIN files f ON f.path_key = e.dst_key
         GROUP BY e.dst_key ORDER BY importers DESC LIMIT ?`,
      )
      .all(limit);
  }

  /** 文件是否已有图谱数据 */
  hasFile(pathKey: string): boolean {
    return this.db.query<{ c: number }, SQLQueryBindings[]>('SELECT COUNT(*) AS c FROM files WHERE path_key = ?').get(pathKey.toLowerCase())!.c > 0;
  }

  counts(): { fileCount: number; symbolCount: number; edgeCount: number } {
    const files = this.db.query<{ c: number }, SQLQueryBindings[]>('SELECT COUNT(*) AS c FROM files').get()!;
    const symbols = this.db.query<{ c: number }, SQLQueryBindings[]>('SELECT COUNT(*) AS c FROM symbols').get()!;
    const edges = this.db.query<{ c: number }, SQLQueryBindings[]>('SELECT COUNT(*) AS c FROM file_edges').get()!;
    return { fileCount: files.c, symbolCount: symbols.c, edgeCount: edges.c };
  }

  /** 清空（重建用） */
  clear(): void {
    this.db.transaction(() => {
      this.db.exec('DELETE FROM symbols;');
      this.db.exec('DELETE FROM file_edges;');
      this.db.exec('DELETE FROM files;');
    })();
  }

  /** 已解析文件 pathKey 集合（增量判断用） */
  parsedFileKeys(): Set<string> {
    return new Set(this.db.query<{ path_key: string }, SQLQueryBindings[]>('SELECT path_key FROM files').all().map(r => r.path_key));
  }
}
