// builtin/write/index.ts
// write 工具 execute 逻辑：原子写入 + 哈希备份 + read-before-overwrite + diff 返回。
// 元数据见同目录 tool.json。
//
// 强化点（对标 Claude Code / avifenesh 最佳实践）：
// 1. 原子写入（tmp+fsync+rename，防中断损坏）
// 2. 改前哈希备份（同内容去重，支持 undo）
// 3. read-before-overwrite（覆盖已存在文件前强制校验本会话已 read）
// 4. 大小限制（默认 10MB，防 LLM 注入超大内容）
// 5. 路径类型预检查（拒绝写入目录，友好错误）
// 6. BOM 保留（原子写入层自动处理）
// 7. 返回 unified diff（供 LLM 审视改动）

import { t } from '../../../../core/i18n';
import { ServiceNames } from '../../../../core/types';
import { existsSync, statSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { resolveWithinCwd } from '../../../../utils/fs';
import { atomicWriteFile } from '../../../file-history/atomic-write';
import { computeLineDiff } from '../../../file-history/diff';
import type { FileHistoryService } from '../../../contracts';
import type { ToolContext, ToolResult } from '../../types';

/** 从 ctx.services 解析 FileHistoryService（可能未加载，返回 null） */
function getFileHistory(ctx: ToolContext): FileHistoryService | null {
  return ctx.services.tryResolve<FileHistoryService>(ServiceNames.FILE_HISTORY);
}

/** 计算字符串 sha256 */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = params as { path: string; content: string; createDirs?: boolean };

    // 1. 基础参数校验
    if (!p.path) {
      return { content: [{ type: 'text', text: 'Error: path is required' }], isError: true };
    }
    if (typeof p.content !== 'string') {
      return { content: [{ type: 'text', text: 'Error: content must be a string' }], isError: true };
    }

    // 2. 从 toolConfig 读取配置
    const toolConfig = (ctx.toolConfig ?? {}) as {
      maxFileSize?: number;
      trackHistory?: boolean;
      requireReadBeforeOverwrite?: boolean;
    };
    const maxFileSize = toolConfig.maxFileSize ?? 10 * 1024 * 1024;
    const trackHistory = toolConfig.trackHistory ?? true;
    const requireReadBeforeOverwrite = toolConfig.requireReadBeforeOverwrite ?? true;

    // 3. 大小限制（用字节长度，正确处理多字节字符）
    const contentBytes = Buffer.byteLength(p.content, 'utf8');
    if (contentBytes > maxFileSize) {
      return {
        content: [{ type: 'text', text: `Error: ${t('tools.fileSizeExceeded', { size: contentBytes, max: maxFileSize })}` }],
        isError: true,
      };
    }

    // 4. 路径解析与越权检测
    const absPath = resolveWithinCwd(p.path, ctx.cwd);
    if (!absPath) {
      return {
        content: [{ type: 'text', text: `Error: path "${p.path}" escapes working directory` }],
        isError: true,
      };
    }

    // 5. 路径类型预检查：若已存在且是目录则拒绝
    const fileExists = existsSync(absPath);
    if (fileExists) {
      try {
        if (statSync(absPath).isDirectory()) {
          return {
            content: [{ type: 'text', text: `Error: ${t('tools.pathIsDirectory', { path: absPath })}` }],
            isError: true,
          };
        }
      } catch {
        // stat 失败不阻断，后续写入会抛错
      }
    }

    // 6. read-before-overwrite 强制校验
    const fileHistory = getFileHistory(ctx);
    if (fileExists && requireReadBeforeOverwrite && fileHistory) {
      if (!fileHistory.isRead(ctx.sessionId, absPath)) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${t('tools.readBeforeOverwriteRequired', { path: absPath })}\n请先调用 read 工具读取该文件，再执行 write 覆盖。`,
          }],
          isError: true,
        };
      }
    }

    // 7. Track Edit：改前备份（同步阻塞，必须在写入前完成）
    const createDirs = p.createDirs ?? true;
    let trackResult: Awaited<ReturnType<FileHistoryService['trackEdit']>> | null = null;
    if (trackHistory && fileHistory) {
      try {
        trackResult = await fileHistory.trackEdit(ctx.sessionId, absPath, ctx.toolCallId, 'write');
      } catch (err) {
        // 备份失败不阻断写入，仅记录日志（undo 不可用）
        ctx.logger.warn('write: trackEdit failed, undo will be unavailable', {
          path: absPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 8. 读取原内容（用于 diff）
    let oldContent = '';
    if (fileExists) {
      try {
        oldContent = readFileSync(absPath, 'utf8');
      } catch {
        // 读取失败忽略，diff 将为空
      }
    }

    // 9. 创建父目录（若需要）
    if (createDirs) {
      try {
        mkdirSync(dirname(absPath), { recursive: true });
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error creating directory: ${err instanceof Error ? err.message : err}` }],
          isError: true,
        };
      }
    }

    // 10. 原子写入
    try {
      atomicWriteFile(absPath, p.content, { fsync: true, preserveBom: true, preserveMode: true });
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error writing file: ${err instanceof Error ? err.message : err}` }],
        isError: true,
      };
    }

    // 11. 计算 diff（原文件存在时）
    const diff = fileExists && oldContent !== p.content
      ? computeLineDiff(oldContent, p.content)
      : '';

    // 12. 记录历史条目（写入 transcript）
    if (trackResult && fileHistory) {
      try {
        const hashAfter = sha256(p.content);
        fileHistory.recordChange(
          ctx.sessionId,
          absPath,
          trackResult,
          hashAfter,
          contentBytes,
          diff || undefined,
        );
      } catch (err) {
        ctx.logger.warn('write: recordChange failed', {
          path: absPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 13. 返回丰富结果
    const operation = fileExists ? 'overwrite' : 'create';
    ctx.logger.info(t('tools.fileWritten', { path: absPath }), { bytes: contentBytes, operation });

    const summary = `Successfully ${operation === 'create' ? 'created' : 'overwrote'} ${absPath} (${contentBytes} bytes)`;
    const diffSection = diff ? `\n\n--- unified diff ---\n${diff}` : '';
    const backupNote = trackResult?.backedUp
      ? `\n[backup created: ${trackResult.backupPath}]`
      : '';

    return {
      content: [{ type: 'text', text: summary + diffSection + backupNote }],
      metadata: {
        path: absPath,
        bytes: contentBytes,
        operation,
        createdDirs: createDirs,
        diff: diff || undefined,
        hashBefore: trackResult?.hash || null,
        hashAfter: sha256(p.content),
        entryId: trackResult?.entryId || null,
        backedUp: trackResult?.backedUp ?? false,
      },
    };
  },
};
