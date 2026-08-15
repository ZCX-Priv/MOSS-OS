// src/modules/filesys/hash.ts
// 全项目唯一 sha256 实现。
// 规范（修复 BOM 乐观锁断裂 bug 的根本决策）：
//   哈希语义 = "磁盘内容指纹"（乐观锁 / 备份去重），必须对磁盘原始字节（含 BOM）计算。
//   read 的 metadata.sha256、edit 的 expectHash 比对、write 流式哈希、file-history 备份去重
//   四者一律经由本文件，禁止各处自行 createHash。

import { createHash } from 'node:crypto';

/** 对原始字节（含 BOM）计算 sha256 —— 唯一合法的文件内容哈希入口 */
export function hashBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** 字符串内容哈希（按 utf8 编码转字节；仅在内容本身即最终字节时使用） */
export function hashText(text: string): string {
  return hashBuffer(Buffer.from(text, 'utf8'));
}
