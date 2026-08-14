// write/handlers/text.ts
// 文本写入 handler：流式原子写入 + diff 计算 + 哈希。
// 只关心「如何写文本」，不关心 read-before-overwrite / trackEdit / 权限确认（调度层负责）。
// 返回纯数据，由调度层组装 ToolResult 和调用 fileHistory 服务。
// 路径：write/handlers/text.ts → file-history = ../../../../file-history

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { computeLineDiff } from '../../../../file-history/diff';
import { atomicWriteFileStream } from '../shared/streaming';
import { readOldContentForDiff } from '../shared/diff-guard';

/** text handler 需要的参数 */
export interface WriteTextParams {
  /** 文件绝对路径（已解析，cwd 内） */
  absPath: string;
  /** 写入内容 */
  content: string;
  /** 文件是否已存在（决定 create/overwrite 语义） */
  fileExists: boolean;
  /** 是否自动创建父目录 */
  createDirs: boolean;
}

/** text handler 返回的纯数据结果 */
export interface WriteTextResult {
  /** 写入字节数 */
  bytes: number;
  /** 流式 sha256 哈希 */
  hash: string;
  /** unified diff 文本；null=未计算（新建/跳过），''=内容相同，非空=diff 或占位 */
  diff: string | null;
  /** 操作类型 */
  operation: 'create' | 'overwrite';
}

/**
 * 执行文本写入：流式原子写入 + diff + 哈希。
 *
 * 流程：
 * 1. 创建父目录（若 createDirs）
 * 2. 读取 oldContent（大文件跳过时不读，防爆内存）
 * 3. 流式原子写入（createWriteStream 分块 + 流式 sha256）
 * 4. 计算 diff（oldContent 为 null 时跳过）
 *
 * @throws 父目录创建失败或写入失败时抛出 Error，由调度层捕获
 */
export async function writeText(params: WriteTextParams): Promise<WriteTextResult> {
  const { absPath, content, fileExists, createDirs } = params;

  // 1. 创建父目录（若需要）
  if (createDirs) {
    mkdirSync(dirname(absPath), { recursive: true });
  }

  // 2. 计算字节大小（用于 diff 守卫判断）
  const contentBytes = Buffer.byteLength(content, 'utf8');

  // 3. 读取 oldContent（大文件跳过时不读，防爆内存核心点）
  const oldContent = readOldContentForDiff(absPath, fileExists, contentBytes);

  // 4. 流式原子写入 + 流式 sha256
  const { bytes, hash } = await atomicWriteFileStream(absPath, content, {
    fsync: true,
    preserveBom: true,
    preserveMode: true,
  });

  // 5. 计算 diff（oldContent 为 null 时跳过；内容相同时 computeLineDiff 返回空字符串）
  let diff: string | null = null;
  if (oldContent !== null && oldContent !== content) {
    diff = computeLineDiff(oldContent, content);
  }

  return {
    bytes,
    hash,
    diff,
    operation: fileExists ? 'overwrite' : 'create',
  };
}
