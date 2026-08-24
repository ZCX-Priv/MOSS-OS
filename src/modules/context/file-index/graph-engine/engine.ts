// src/modules/context/file-index/graph-engine/engine.ts
// 图谱引擎主流程：消费索引引擎文件列表与变更批次 → tree-sitter 解析 → 符号/import 入库。
// 后台逐文件构建（不阻塞交互）；变更文件重解析（事务内删旧插新）。

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IndexEngine } from '../index-engine/engine';
import { pathKey } from '../shared/scanner';
import { dirSize } from '../shared/store';
import type { FileChangeBatch, FileIndexRuntimeDeps, GraphEngineStatus } from '../types';
import { extractFile } from './extract';
import { GraphStore } from './store';

/** 单文件读取上限（1MB；超限跳过解析） */
const MAX_PARSE_BYTES = 1024 * 1024;

export class GraphEngine {
  private store: GraphStore | null = null;
  private running = false;
  private stopped = false;
  private buildAbort: AbortController | null = null;
  /** 变更处理队列（串行化，防并发写冲突） */
  private queue: FileChangeBatch[] = [];
  private processing = false;

  private state: GraphEngineStatus = {
    enabled: true,
    state: 'disabled',
    progress: null,
    fileCount: 0,
    symbolCount: 0,
    edgeCount: 0,
    storeBytes: 0,
    error: null,
  };

  constructor(
    private readonly root: string,
    private readonly dataDir: string,
    private readonly indexEngine: IndexEngine,
    private readonly deps: FileIndexRuntimeDeps,
  ) {}

  get status(): Readonly<GraphEngineStatus> {
    return this.state;
  }

  get ready(): boolean {
    return this.state.state === 'ready';
  }

  get graphStore(): GraphStore | null {
    return this.store;
  }

  private unsubscribe: (() => void) | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    try {
      this.store = new GraphStore(this.dataDir);
      this.state = { ...this.state, state: 'scanning', progress: { phase: 'parse', percent: 0 }, error: null };
      this.deps.onStatusChange();

      // 后台全量构建：解析索引引擎已知的全部代码文件
      this.buildAbort = new AbortController();
      await this.buildAll(this.buildAbort.signal);

      if (this.stopped) return;
      this.state = { ...this.state, state: 'ready', progress: null };
      this.refreshStats();
      this.deps.onStatusChange();

      // 订阅索引引擎变更
      this.unsubscribe = this.indexEngine.subscribeChanges(batch => this.enqueueBatch(batch));
    } catch (err) {
      this.state = {
        ...this.state,
        state: 'error',
        progress: null,
        error: err instanceof Error ? err.message : String(err),
      };
      this.deps.onStatusChange();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.running = false;
    this.buildAbort?.abort();
    this.buildAbort = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.queue = [];
    this.store?.close();
    this.store = null;
    this.state = { ...this.state, state: 'disabled', progress: null };
    this.deps.onStatusChange();
  }

  /** 全量构建（增量：已有数据且文件未变更时跳过重解析） */
  private async buildAll(signal: AbortSignal): Promise<void> {
    if (!this.store) return;
    const parsed = this.store.parsedFileKeys();
    const files: Array<{ rel: string; ext: string; size: number }> = [];
    const fileSet = new Set<string>();
    for (const e of this.indexEngine.entries.values()) {
      if (e.isDir) continue;
      fileSet.add(pathKey(e.rel));
    }
    for (const e of this.indexEngine.entries.values()) {
      if (e.isDir || e.size > MAX_PARSE_BYTES) continue;
      if (parsed.has(pathKey(e.rel))) continue; // 增量：已解析且未变更
      files.push({ rel: e.rel, ext: e.ext, size: e.size });
    }

    let done = 0;
    for (const f of files) {
      if (signal.aborted || this.stopped) return;
      await this.parseAndStore(f.rel, f.ext, fileSet);
      done++;
      if (done % 20 === 0 || done === files.length) {
        const percent = files.length === 0 ? 100 : Math.round((done / files.length) * 100);
        this.state = { ...this.state, progress: { phase: 'parse', percent } };
        this.deps.onStatusChange();
      }
    }
  }

  /** 解析单文件并入库 */
  private async parseAndStore(rel: string, ext: string, fileSet: Set<string>): Promise<void> {
    if (!this.store) return;
    try {
      const source = await readFile(join(this.root, rel), 'utf8');
      const result = await extractFile(rel, ext, source, fileSet);
      this.store.replaceFile(pathKey(rel), rel, result.symbols, result.imports);
    } catch {
      // 读取/解析失败静默跳过（竞态删除、编码异常等）
    }
  }

  /** 变更批次入队（串行处理） */
  private enqueueBatch(batch: FileChangeBatch): void {
    if (this.stopped || !this.store) return;
    this.queue.push(batch);
    void this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    if (this.processing || this.stopped) return;
    this.processing = true;
    try {
      while (this.queue.length > 0 && !this.stopped) {
        const batch = this.queue.shift()!;
        await this.applyBatch(batch);
      }
    } finally {
      this.processing = false;
    }
    this.refreshStats();
    this.deps.onStatusChange();
  }

  private async applyBatch(batch: FileChangeBatch): Promise<void> {
    if (!this.store) return;
    const fileSet = new Set<string>();
    for (const e of this.indexEngine.entries.values()) {
      if (!e.isDir) fileSet.add(pathKey(e.rel));
    }
    // 先处理删除与修改（重新解析），再处理新增
    for (const key of batch.removed) {
      this.store.removeFile(key);
    }
    for (const e of [...batch.modified, ...batch.added]) {
      if (e.isDir || e.size > MAX_PARSE_BYTES) continue;
      await this.parseAndStore(e.rel, e.ext, fileSet);
    }
  }

  private refreshStats(): void {
    if (!this.store) return;
    const c = this.store.counts();
    this.state = {
      ...this.state,
      fileCount: c.fileCount,
      symbolCount: c.symbolCount,
      edgeCount: c.edgeCount,
      storeBytes: dirSize(this.dataDir),
    };
  }

  /** 手动重建（清空后全量） */
  async rebuild(): Promise<void> {
    if (!this.store) return;
    this.store.clear();
    this.buildAbort = new AbortController();
    this.state = { ...this.state, state: 'scanning', progress: { phase: 'parse', percent: 0 } };
    this.deps.onStatusChange();
    await this.buildAll(this.buildAbort.signal);
    if (this.stopped) return;
    this.state = { ...this.state, state: 'ready', progress: null };
    this.refreshStats();
    this.deps.onStatusChange();
  }
}
