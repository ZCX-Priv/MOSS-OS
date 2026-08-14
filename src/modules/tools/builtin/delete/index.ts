// builtin/delete/index.ts
// delete 工具 execute 逻辑：删除文件或目录（递归）。破坏性操作。
// 强化点：删除前 trackEdit 哈希备份（支持 undo 恢复）。
// 注意：目录删除仅备份目录本身的 stat 信息有限，undo 主要针对文件恢复。

import { t } from '../../../../core/i18n';
import { ServiceNames } from '../../../../core/types';
import { existsSync, statSync, unlinkSync, rmSync } from 'node:fs';
import { resolveWithinCwd } from '../../../../utils/fs';
import type { FileHistoryService } from '../../../contracts';
import type { ToolContext, ToolResult } from '../../types';

function getFileHistory(ctx: ToolContext): FileHistoryService | null {
  return ctx.services.tryResolve<FileHistoryService>(ServiceNames.FILE_HISTORY);
}

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = params as { path: string; recursive?: boolean };

    if (!p.path) {
      return { content: [{ type: 'text', text: 'Error: path is required' }], isError: true };
    }

    const absPath = resolveWithinCwd(p.path, ctx.cwd);
    if (!absPath) {
      return {
        content: [{ type: 'text', text: `Error: path "${p.path}" escapes working directory` }],
        isError: true,
      };
    }

    if (!existsSync(absPath)) {
      return {
        content: [{ type: 'text', text: `Error: path not found: ${absPath}` }],
        isError: true,
      };
    }

    const stat = statSync(absPath);
    const isDir = stat.isDirectory();

    // Track Edit：删除前备份（仅文件，目录不备份内容）
    const toolConfig = (ctx.toolConfig ?? {}) as { trackHistory?: boolean };
    const trackHistory = toolConfig.trackHistory ?? true;
    const fileHistory = getFileHistory(ctx);
    let trackResult: Awaited<ReturnType<FileHistoryService['trackEdit']>> | null = null;

    if (trackHistory && fileHistory && !isDir) {
      try {
        trackResult = await fileHistory.trackEdit(ctx.sessionId, absPath, ctx.toolCallId, 'delete');
      } catch (err) {
        ctx.logger.warn('delete: trackEdit failed, undo will be unavailable', {
          path: absPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    try {
      if (isDir) {
        if (!p.recursive) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: "${absPath}" is a directory. Set recursive=true to delete it recursively.`,
              },
            ],
            isError: true,
          };
        }
        rmSync(absPath, { recursive: true, force: false });
        ctx.logger.info(t('tools.directoryDeleted', { path: absPath }));

        // 目录删除记录历史（undo 会尝试恢复但目录内容无法完整恢复，记录警告）
        if (trackHistory && fileHistory) {
          // 目录删除的 undo 能力有限，仅记录条目
        }

        return {
          content: [{ type: 'text', text: `Successfully deleted directory: ${absPath}` }],
          metadata: { path: absPath, type: 'directory', recursive: true, backedUp: false },
        };
      }

      unlinkSync(absPath);
      ctx.logger.info(t('tools.fileDeleted', { path: absPath }));

      // 记录历史条目（文件删除，hashAfter=null, bytesAfter=0）
      if (trackResult && fileHistory) {
        try {
          fileHistory.recordChange(
            ctx.sessionId,
            absPath,
            trackResult,
            '', // hashAfter 空字符串（已删除）
            0,  // bytesAfter=0
            undefined,
          );
        } catch (err) {
          ctx.logger.warn('delete: recordChange failed', {
            path: absPath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const backupNote = trackResult?.backedUp
        ? `\n[backup created: ${trackResult.backupPath}, undo available]`
        : '';

      return {
        content: [{ type: 'text', text: `Successfully deleted file: ${absPath}${backupNote}` }],
        metadata: {
          path: absPath,
          type: 'file',
          backedUp: trackResult?.backedUp ?? false,
          entryId: trackResult?.entryId || null,
        },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error deleting path: ${err instanceof Error ? err.message : err}` }],
        isError: true,
      };
    }
  },
};
