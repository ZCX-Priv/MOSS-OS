// src/modules/context/file-index/sag-engine/engine.ts
// SAG 引擎主流程：chunk 化（图谱符号块/行块）→ 规则实体抽取（同步）→
// 后台 LLM 语义抽取（批量节流）→ 动态超边检索。
// 消费索引引擎变更批次，变更文件重新 chunk。

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMRouter } from '../../../contracts';
import type { IndexEngine } from '../index-engine/engine';
import type { GraphEngine } from '../graph-engine/engine';
import { pathKey } from '../shared/scanner';
import { dirSize } from '../shared/store';
import type {
  FileChangeBatch,
  FileIndexRuntimeDeps,
  SagEngineConfig,
  SagEngineStatus,
  SagSearchResult,
} from '../types';
import { chunkText, isCodeExt, ruleSummary, type RawChunk } from './chunker';
import { extractRuleEntities } from './extract-rules';
import { SagLlmExtractor } from './extract-llm';
import { sagSearch } from './search';
import { SagStore } from './store';

const MAX_READ_BYTES = 512 * 1024;

export class SagEngine {
  private store: SagStore | null = null;
  private llmExtractor: SagLlmExtractor | null = null;
  private running = false;
  private stopped = false;
  private buildAbort: AbortController | null = null;
  private queue: FileChangeBatch[] = [];
  private processing = false;
  private unsubscribe: (() => void) | null = null;

  private state: SagEngineStatus = {
    enabled: true,
    state: 'disabled',
    progress: null,
    chunkCount: 0,
    eventCount: 0,
    entityCount: 0,
    llmExtracted: 0,
    llmBudget: 2000,
    storeBytes: 0,
    error: null,
  };

  constructor(
    private readonly root: string,
    private readonly dataDir: string,
    private readonly config: SagEngineConfig,
    private readonly indexEngine: IndexEngine,
    private readonly graphEngine: GraphEngine | null,
    /** LLM router（不可用时纯规则模式） */
    private readonly llm: LLMRouter | null,
    /** 主模型解析（inherit 时用） */
    private readonly resolveMainModel: () => string,
    private readonly deps: FileIndexRuntimeDeps,
  ) {}

  get status(): Readonly<SagEngineStatus> {
    return this.state;
  }

  get ready(): boolean {
    return this.state.state === 'ready';
  }

  get sagStore(): SagStore | null {
    return this.store;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    try {
      this.store = new SagStore(this.dataDir);
      this.state = {
        ...this.state,
        state: 'scanning',
        progress: { phase: 'extract', percent: 0 },
        error: null,
        llmBudget: this.config.llmMaxChunks,
      };
      this.deps.onStatusChange();

      this.buildAbort = new AbortController();
      await this.buildAll(this.buildAbort.signal);
      if (this.stopped) return;

      this.state = { ...this.state, state: 'ready', progress: null };
      this.refreshStats();
      this.deps.onStatusChange();

      // 后台 LLM 语义抽取（低优先级补齐）
      this.llmExtractor = new SagLlmExtractor(
        this.store,
        this.config,
        this.llm,
        () => this.resolveLlmModel(),
        this.deps,
      );
      this.llmExtractor.start();

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
    this.llmExtractor?.stop();
    this.llmExtractor = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.queue = [];
    this.store?.close();
    this.store = null;
    this.state = { ...this.state, state: 'disabled', progress: null };
    this.deps.onStatusChange();
  }

  /** LLM 抽取模型解析（inherit → 主模型；否则 providers 模型名回退主模型） */
  private resolveLlmModel(): string {
    const configured = this.config.llmModel;
    if (configured === 'inherit' || configured === '') return this.resolveMainModel();
    // 模型存在性校验由调用方（service 层）传入的 resolveMainModel 保证一致回退；
    // 此处直接返回配置名，router 层按 id/model 匹配，未命中时报错由批次退避处理
    return configured;
  }

  /** 全量构建：对索引引擎已知文本文件 chunk 化 + 规则抽取入库（增量：已有数据跳过） */
  private async buildAll(signal: AbortSignal): Promise<void> {
    if (!this.store) return;
    const chunked = this.store.chunkedFileKeys();
    const files: Array<{ rel: string; ext: string; size: number }> = [];
    for (const e of this.indexEngine.entries.values()) {
      if (e.isDir || e.kind === 'binary' || e.size > MAX_READ_BYTES) continue;
      if (chunked.has(pathKey(e.rel))) continue; // 增量
      files.push({ rel: e.rel, ext: e.ext, size: e.size });
    }

    let done = 0;
    for (const f of files) {
      if (signal.aborted || this.stopped) return;
      await this.chunkAndStore(f.rel, f.ext);
      done++;
      if (done % 40 === 0 || done === files.length) {
        const percent = files.length === 0 ? 100 : Math.round((done / files.length) * 100);
        this.state = { ...this.state, progress: { phase: 'extract', percent } };
        this.deps.onStatusChange();
      }
    }
  }

  /** 单文件 chunk + 规则实体抽取 + 入库 */
  private async chunkAndStore(rel: string, ext: string): Promise<void> {
    if (!this.store) return;
    try {
      const source = await readFile(join(this.root, rel), 'utf8');
      const isCode = isCodeExt(ext);
      // 代码文件优先用图谱符号块（语义完整）
      const symbols = isCode && this.graphEngine?.graphStore
        ? this.graphEngine.graphStore.fileSymbols(pathKey(rel)).map(s => ({ line: s.line, endLine: s.end_line }))
        : null;
      const chunks = chunkText(source, isCode, symbols);
      if (!chunks) return;

      const rows = chunks.map((c: RawChunk) => ({
        startLine: c.startLine,
        endLine: c.endLine,
        content: c.content,
        summary: ruleSummary(c, isCode),
        entities: extractRuleEntities(c.content, isCode).map(e => ({ name: e.name, type: e.type })),
      }));
      this.store.replaceFileChunks(pathKey(rel), rel, rows);
    } catch {
      // 读取/编码失败静默跳过
    }
  }

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
        for (const key of batch.removed) {
          this.store?.removeFile(key);
        }
        for (const e of [...batch.modified, ...batch.added]) {
          if (e.isDir || e.kind === 'binary' || e.size > MAX_READ_BYTES) continue;
          await this.chunkAndStore(e.rel, e.ext);
        }
      }
    } finally {
      this.processing = false;
    }
    this.refreshStats();
    this.deps.onStatusChange();
  }

  private refreshStats(): void {
    if (!this.store) return;
    const c = this.store.counts();
    this.state = {
      ...this.state,
      chunkCount: c.chunkCount,
      eventCount: c.eventCount,
      entityCount: c.entityCount,
      llmExtracted: c.llmExtracted,
      storeBytes: dirSize(this.dataDir),
    };
  }

  /** SAG 检索（动态超边） */
  search(query: string, topK?: number): SagSearchResult[] {
    if (!this.store) return [];
    return sagSearch(this.store, query, topK);
  }

  /** 高频实体（项目概要用） */
  topEntities(limit: number): Array<{ name: string; type: string; refs: number }> {
    return this.store?.topEntities(limit) ?? [];
  }

  async rebuild(): Promise<void> {
    if (!this.store) return;
    this.llmExtractor?.stop();
    this.store.clear();
    this.buildAbort = new AbortController();
    this.state = { ...this.state, state: 'scanning', progress: { phase: 'extract', percent: 0 } };
    this.deps.onStatusChange();
    await this.buildAll(this.buildAbort.signal);
    if (this.stopped) return;
    this.state = { ...this.state, state: 'ready', progress: null };
    this.refreshStats();
    this.deps.onStatusChange();
    this.llmExtractor?.start();
  }
}
