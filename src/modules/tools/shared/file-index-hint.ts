// src/modules/tools/shared/file-index-hint.ts
// 工具层文件索引访问辅助：影响面注入（edit/write）与索引加速（glob/grep）。
// 索引关闭/未就绪时全部安全降级（返回 null，零开销回退原逻辑）。

import { relative, isAbsolute } from 'node:path';
import { ServiceNames } from '../../../core/types';
import type { ContextEngine, FileIndexServiceLike } from '../../contracts';
import type { ToolContext } from '../types';

/** 解析文件索引服务（不可用返回 null） */
export function getFileIndex(ctx: ToolContext): FileIndexServiceLike | null {
  const engine = ctx.services.tryResolve<ContextEngine>(ServiceNames.CONTEXT_ENGINE);
  if (!engine) return null;
  try {
    return engine.getFileIndex();
  } catch {
    return null;
  }
}

/** 绝对路径 → 相对 cwd 的正斜杠路径（影响面查询键；cwd 外返回 null） */
export function relFromCwd(absPath: string, cwd: string): string | null {
  if (!cwd) return null;
  const rel = relative(cwd, absPath);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split('\\').join('/');
}

/** edit/write 成功后的影响面文本（图谱未就绪/关闭返回 null） */
export async function impactHintFor(ctx: ToolContext, absPath: string): Promise<string | null> {
  const fileIndex = getFileIndex(ctx);
  if (!fileIndex) return null;
  const rel = relFromCwd(absPath, ctx.cwd || process.cwd());
  if (!rel) return null;
  try {
    return await fileIndex.impactHint(ctx.cwd || process.cwd(), rel);
  } catch {
    return null;
  }
}
