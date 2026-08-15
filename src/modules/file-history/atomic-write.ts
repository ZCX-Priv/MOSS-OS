// src/modules/file-history/atomic-write.ts
// 原子写入实现已下沉到 utils 层（src/utils/fs-atomic.ts），供 core（config-service）与
// modules（filesys/file-history/agent 存储）统一引用，消除层级反向依赖。
// 此处保留 re-export：既有 import 路径零改动，行为完全一致。

export {
  atomicWriteFile,
  resolveRealPath,
  buildTmpPath,
  getOriginalMode,
  readHeadBytes,
} from '../../utils/fs-atomic';
export type { AtomicWriteOptions } from '../../utils/fs-atomic';
