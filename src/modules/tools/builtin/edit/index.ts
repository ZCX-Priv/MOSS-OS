// builtin/edit/index.ts
// edit 工具 execute 逻辑：精确字符串匹配替换，oldString 必须唯一，支持 replaceAll。
// 强化点：read-before-overwrite + trackEdit 哈希备份 + 原子写入 + diff 返回。
// BOM 处理沿用原逻辑（读取时 stripBom，写回时根据 hadBom 决定是否加回）。

import { t } from '../../../../core/i18n';
import { ServiceNames } from '../../../../core/types';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hasUtf8Bom, stripBom } from '../../../../utils/encoding';
import { resolveWithinCwd } from '../../../../utils/fs';
import { atomicWriteFile } from '../../../file-history/atomic-write';
import { computeLineDiff } from '../../../file-history/diff';
import type { FileHistoryService } from '../../../contracts';
import type { ToolContext, ToolResult } from '../../types';

function getFileHistory(ctx: ToolContext): FileHistoryService | null {
  return ctx.services.tryResolve<FileHistoryService>(ServiceNames.FILE_HISTORY);
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = params as {
      path: string;
      oldString: string;
      newString: string;
      replaceAll?: boolean;
    };

    // 1. 基础参数校验
    if (!p.path) {
      return { content: [{ type: 'text', text: 'Error: path is required' }], isError: true };
    }
    if (typeof p.oldString !== 'string' || typeof p.newString !== 'string') {
      return { content: [{ type: 'text', text: 'Error: oldString and newString must be strings' }], isError: true };
    }
    if (p.oldString === p.newString) {
      return { content: [{ type: 'text', text: 'Error: oldString and newString are identical' }], isError: true };
    }
    if (p.oldString === '') {
      return { content: [{ type: 'text', text: 'Error: oldString cannot be empty' }], isError: true };
    }

    // 2. 路径解析
    const absPath = resolveWithinCwd(p.path, ctx.cwd);
    if (!absPath) {
      return {
        content: [{ type: 'text', text: `Error: path "${p.path}" escapes working directory` }],
        isError: true,
      };
    }

    if (!existsSync(absPath)) {
      return {
        content: [{ type: 'text', text: `Error: file not found: ${absPath}` }],
        isError: true,
      };
    }

    // 3. 路径类型预检查
    try {
      if (statSync(absPath).isDirectory()) {
        return {
          content: [{ type: 'text', text: `Error: ${t('tools.pathIsDirectory', { path: absPath })}` }],
          isError: true,
        };
      }
    } catch {
      // 忽略
    }

    // 4. read-before-overwrite 校验
    const toolConfig = (ctx.toolConfig ?? {}) as {
      trackHistory?: boolean;
      requireReadBeforeOverwrite?: boolean;
    };
    const trackHistory = toolConfig.trackHistory ?? true;
    const requireReadBeforeOverwrite = toolConfig.requireReadBeforeOverwrite ?? true;
    const fileHistory = getFileHistory(ctx);

    if (requireReadBeforeOverwrite && fileHistory) {
      if (!fileHistory.isRead(ctx.sessionId, absPath)) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${t('tools.readBeforeOverwriteRequired', { path: absPath })}\n请先调用 read 工具读取该文件，再执行 edit。`,
          }],
          isError: true,
        };
      }
    }

    // 5. 读取文件内容（保留 BOM 检测）
    let content: string;
    let hadBom = false;
    try {
      const rawBuf = readFileSync(absPath);
      hadBom = hasUtf8Bom(rawBuf);
      content = stripBom(rawBuf.toString('utf8'));
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error reading file: ${err instanceof Error ? err.message : err}` }],
        isError: true,
      };
    }

    // 6. oldString 唯一性校验
    const occurrences = countOccurrences(content, p.oldString);
    if (occurrences === 0) {
      return {
        content: [{ type: 'text', text: `Error: oldString not found in ${absPath}` }],
        isError: true,
      };
    }

    if (occurrences > 1 && !p.replaceAll) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: oldString appears ${occurrences} times in ${absPath}. ` +
              `Make oldString more specific or set replaceAll=true.`,
          },
        ],
        isError: true,
      };
    }

    // 7. Track Edit：改前备份
    let trackResult: Awaited<ReturnType<FileHistoryService['trackEdit']>> | null = null;
    if (trackHistory && fileHistory) {
      try {
        trackResult = await fileHistory.trackEdit(ctx.sessionId, absPath, ctx.toolCallId, 'edit');
      } catch (err) {
        ctx.logger.warn('edit: trackEdit failed, undo will be unavailable', {
          path: absPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 8. 执行替换
    let newContent: string;
    let replacements: number;
    if (p.replaceAll) {
      newContent = content.split(p.oldString).join(p.newString);
      replacements = occurrences;
    } else {
      newContent = content.replace(p.oldString, p.newString);
      replacements = 1;
    }

    // 9. 原子写入（保留 BOM）
    try {
      atomicWriteFile(absPath, newContent, {
        fsync: true,
        preserveBom: false, // edit 自己处理 BOM（下面手动加回）
        preserveMode: true,
      });
      // BOM 处理：若原文件有 BOM，确保写入后也保留
      // 注意：atomicWriteFile 的 preserveBom=false，我们手动在内容前加 BOM
      if (hadBom) {
        // 重新原子写入带 BOM 的内容（覆盖刚才的）
        atomicWriteFile(absPath, '\uFEFF' + newContent, {
          fsync: true,
          preserveBom: false,
          preserveMode: true,
        });
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error writing file: ${err instanceof Error ? err.message : err}` }],
        isError: true,
      };
    }

    // 10. 计算 diff
    const diff = computeLineDiff(content, newContent);

    // 11. 记录历史条目
    if (trackResult && fileHistory) {
      try {
        const hashAfter = sha256(newContent);
        fileHistory.recordChange(
          ctx.sessionId,
          absPath,
          trackResult,
          hashAfter,
          Buffer.byteLength(newContent, 'utf8'),
          diff || undefined,
        );
      } catch (err) {
        ctx.logger.warn('edit: recordChange failed', {
          path: absPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    ctx.logger.info(t('tools.fileEdited', { path: absPath }), { replacements });

    const summary = `Successfully edited ${absPath} (${replacements} replacement${replacements > 1 ? 's' : ''})`;
    const diffSection = diff ? `\n\n--- unified diff ---\n${diff}` : '';
    const backupNote = trackResult?.backedUp
      ? `\n[backup created: ${trackResult.backupPath}]`
      : '';

    return {
      content: [{ type: 'text', text: summary + diffSection + backupNote }],
      metadata: {
        path: absPath,
        replacements,
        occurrences,
        diff: diff || undefined,
        hashBefore: trackResult?.hash || null,
        hashAfter: sha256(newContent),
        entryId: trackResult?.entryId || null,
        backedUp: trackResult?.backedUp ?? false,
      },
    };
  },
};

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}
