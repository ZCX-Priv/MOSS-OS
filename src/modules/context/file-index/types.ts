// src/modules/context/file-index/types.ts
// 文件索引模块类型契约：三引擎（索引/图谱/SAG）配置、状态、事件。
// 数据目录：~/.moss/file-index/<projectHash>/{index-list,graph,sag}（按项目隔离）。

import type { Environment, Logger } from '../../../core/types';

// ============================================================================
// 配置（config.context.fileIndex，Zod schema 见 config-service.ts）
// ============================================================================

export interface IndexingEngineConfig {
  /** 索引引擎开关（图谱/SAG 的前置依赖） */
  enabled: boolean;
}

export interface GraphEngineConfig {
  /** 图谱引擎开关 */
  enabled: boolean;
}

export interface SagEngineConfig {
  /** SAG 引擎开关 */
  enabled: boolean;
  /** LLM 语义抽取模型：'inherit' = 主模型；否则为 providers 旗下模型 id */
  llmModel: string;
  /** 每项目 LLM 抽取预算上限（chunk 数）；用尽即停 */
  llmMaxChunks: number;
}

export interface FileIndexConfig {
  indexing: IndexingEngineConfig;
  graph: GraphEngineConfig;
  sag: SagEngineConfig;
  /** 额外忽略 glob（默认忽略列表之外） */
  ignore: string[];
}

export const DEFAULT_INDEXING_ENGINE_CONFIG: IndexingEngineConfig = {
  enabled: false,
};

export const DEFAULT_GRAPH_ENGINE_CONFIG: GraphEngineConfig = {
  enabled: false,
};

export const DEFAULT_SAG_ENGINE_CONFIG: SagEngineConfig = {
  enabled: false,
  llmModel: 'inherit',
  llmMaxChunks: 2000,
};

export const DEFAULT_FILE_INDEX_CONFIG: FileIndexConfig = {
  indexing: { ...DEFAULT_INDEXING_ENGINE_CONFIG },
  graph: { ...DEFAULT_GRAPH_ENGINE_CONFIG },
  sag: { ...DEFAULT_SAG_ENGINE_CONFIG },
  ignore: [],
};

/** 规格化配置：缺段补默认值 + 依赖联动（graph/sag 开启时 indexing 强制开启） */
export function normalizeFileIndexConfig(raw: unknown): FileIndexConfig {
  const cfg = (raw ?? {}) as Partial<FileIndexConfig>;
  const indexing: IndexingEngineConfig = { ...DEFAULT_INDEXING_ENGINE_CONFIG, ...(cfg.indexing ?? {}) };
  const graph: GraphEngineConfig = { ...DEFAULT_GRAPH_ENGINE_CONFIG, ...(cfg.graph ?? {}) };
  const sag: SagEngineConfig = { ...DEFAULT_SAG_ENGINE_CONFIG, ...(cfg.sag ?? {}) };
  // 依赖联动：图谱/SAG 依赖索引引擎的文件列表
  if (graph.enabled || sag.enabled) indexing.enabled = true;
  if (!indexing.enabled) {
    graph.enabled = false;
    sag.enabled = false;
  }
  const ignore = Array.isArray(cfg.ignore) ? cfg.ignore.filter((x): x is string => typeof x === 'string') : [];
  return { indexing, graph, sag, ignore };
}

// ============================================================================
// 文件条目（索引引擎内存/持久化结构）
// ============================================================================

export interface FileEntry {
  /** 相对 cwd 的正斜杠路径（原始大小写） */
  rel: string;
  /** 文件名（含扩展名） */
  name: string;
  /** 小写扩展名（含点，如 '.ts'；目录为 ''） */
  ext: string;
  size: number;
  mtimeMs: number;
  isDir: boolean;
  /** 文本/二进制/未知 粗分类 */
  kind: 'text' | 'binary' | 'unknown';
}

/** 文件变更批次（watcher/扫描产出） */
export interface FileChangeBatch {
  added: FileEntry[];
  modified: FileEntry[];
  /** pathKey（小写正斜杠）列表 */
  removed: string[];
}

// ============================================================================
// 引擎状态（API/WS 透出）
// ============================================================================

export type FileIndexEngineState = 'disabled' | 'scanning' | 'ready' | 'error';

export interface FileIndexProgress {
  /** 阶段标签（如 scan/parse/extract） */
  phase: string;
  /** 0-100 */
  percent: number;
}

export interface IndexingEngineStatus {
  enabled: boolean;
  state: FileIndexEngineState;
  progress: FileIndexProgress | null;
  fileCount: number;
  dirCount: number;
  storeBytes: number;
  error: string | null;
}

export interface GraphEngineStatus {
  enabled: boolean;
  state: FileIndexEngineState;
  progress: FileIndexProgress | null;
  fileCount: number;
  symbolCount: number;
  edgeCount: number;
  storeBytes: number;
  error: string | null;
}

export interface SagEngineStatus {
  enabled: boolean;
  state: FileIndexEngineState;
  progress: FileIndexProgress | null;
  chunkCount: number;
  eventCount: number;
  entityCount: number;
  /** LLM 语义抽取进度（已抽取 chunk 数 / 预算） */
  llmExtracted: number;
  llmBudget: number;
  storeBytes: number;
  error: string | null;
}

export interface FileIndexStatus {
  /** 项目根（cwd 绝对路径） */
  projectRoot: string;
  indexing: IndexingEngineStatus;
  graph: GraphEngineStatus;
  sag: SagEngineStatus;
}

// ============================================================================
// 图谱引擎结构
// ============================================================================

export type SymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'enum'
  | 'constant'
  | 'variable'
  | 'module'
  | 'other';

export interface GraphSymbol {
  /** 所在文件相对路径（正斜杠） */
  file: string;
  name: string;
  kind: SymbolKind;
  /** 1-based 起始行 */
  line: number;
  col: number;
  endLine: number;
  /** 签名首行文本（截断 160 字符） */
  signature: string;
}

export interface GraphImportEdge {
  /** import 发起文件（相对路径） */
  src: string;
  /** import 目标文件（相对路径，已解析为真实文件） */
  dst: string;
}

export interface ImpactResult {
  /** 谁 import 了我（上游，改动影响面） */
  upstream: string[];
  /** 我 import 了谁（下游依赖） */
  downstream: string[];
  /** 本文件符号清单 */
  symbols: Array<Pick<GraphSymbol, 'name' | 'kind' | 'line'>>;
}

// ============================================================================
// SAG 引擎结构
// ============================================================================

export interface SagChunk {
  id: number;
  file: string;
  startLine: number;
  endLine: number;
  content: string;
}

export interface SagSearchResult {
  chunkId: number;
  file: string;
  startLine: number;
  endLine: number;
  /** 事件摘要（LLM 抽取的优先，否则规则生成的首行摘要） */
  summary: string;
  /** 命中得分（种子命中 + 共享实体加权） */
  score: number;
  /** 命中的连接实体（动态超边证据） */
  matchedEntities: string[];
}

// ============================================================================
// 运行时依赖（引擎构造参数）
// ============================================================================

export interface FileIndexRuntimeDeps {
  env: Environment;
  logger: Logger;
  /** 状态变化回调（service 聚合后广播） */
  onStatusChange: () => void;
}
