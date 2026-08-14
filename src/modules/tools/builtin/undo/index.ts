// builtin/undo/index.ts
// undo 工具 execute 逻辑：撤销最近 N 次文件变更，从哈希备份恢复原内容。
// 依赖 FileHistoryService（由 file-history 模组注册）。

import { t } from '../../../../core/i18n';
import { ServiceNames } from '../../../../core/types';
import type { FileHistoryService } from '../../../contracts';
import type { ToolContext, ToolResult } from '../../types';

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = params as { steps?: number };
    // 步数校验与钳制
    const steps = Math.min(Math.max(Math.floor(p.steps ?? 1), 1), 20);

    const fileHistory = ctx.services.tryResolve<FileHistoryService>(ServiceNames.FILE_HISTORY);
    if (!fileHistory) {
      return {
        content: [{ type: 'text', text: `Error: ${t('tools.fileHistoryUnavailable')}` }],
        isError: true,
      };
    }

    try {
      const result = await fileHistory.undo(ctx.sessionId, steps);

      if (result.restored.length === 0 && result.failed.length === 0) {
        return {
          content: [{ type: 'text', text: `No history entries to undo. (remaining: ${result.remaining})` }],
          metadata: result as unknown as Record<string, unknown>,
        };
      }

      const lines: string[] = [];
      if (result.restored.length > 0) {
        lines.push(`Restored ${result.restored.length} file(s):`);
        for (const p of result.restored) {
          lines.push(`  - ${p}`);
        }
      }
      if (result.failed.length > 0) {
        lines.push(`\nFailed to restore ${result.failed.length} file(s):`);
        for (const f of result.failed) {
          lines.push(`  - ${f.absPath}: ${f.error}`);
        }
      }
      lines.push(`\n${result.remaining} history entries remaining.`);

      ctx.logger.info(t('tools.undoRestored', { count: result.restored.length, paths: result.restored.join(', ') }));

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        metadata: result as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${t('fileHistory.undoFailed', { error: err instanceof Error ? err.message : String(err) })}` }],
        isError: true,
      };
    }
  },
};
