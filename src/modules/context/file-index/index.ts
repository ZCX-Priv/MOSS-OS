// src/modules/context/file-index/index.ts
// 文件索引模块出口：三引擎（索引/图谱/SAG）+ 编排服务。
// 隶属上下文引擎子模块——由 ContextEngineServiceImpl 持有（api/service.ts 挂接）。

export { FileIndexService, compileGlobs, type FileIndexServiceDeps } from './service';
export type { FileQuery, FileQueryResult } from './index-engine/query';
export { queryImpact, renderImpactText } from './graph-engine/impact';
export {
  normalizeFileIndexConfig,
  DEFAULT_FILE_INDEX_CONFIG,
  type FileIndexConfig,
  type FileIndexStatus,
  type FileEntry,
  type ImpactResult,
  type SagSearchResult,
  type GraphSymbol,
  type SymbolKind,
} from './types';
