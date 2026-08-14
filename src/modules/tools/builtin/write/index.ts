// builtin/write/index.ts
// write 工具调度层：参数校验 → 路径安全 → read-before-overwrite → trackEdit → 分派到 handler → 组装结果。
// 元数据（name/description/icon/annotations/inputSchema/config）见同目录 tool.json。
// handlers/ 子目录执行实际写入（流式原子写入 + diff + 哈希），shared/ 子目录提供流式写入/diff守卫等公共能力。
//
// 强化点（对标 Claude Code / avifenesh 最佳实践）：
// 1. 流式原子写入（createWriteStream 分块 + tmp+fsync+rename，防中断损坏，支持大文件）
// 2. 改前哈希备份（同内容去重，支持 undo）
// 3. read-before-overwrite（覆盖已存在文件前强制校验本会话已 read）
// 4. 无大小限制（write 不需要，LLM 协议层已约束；read 的限制是为了防止 ai 吃不下，与 write 场景不同）
// 5. 大文件跳过 diff 且不读 oldContent（防爆内存，避免 O(n*m) 矩阵和 oldContent 全量读取）
// 6. BOM 保留 + 权限保留（流式写入层自动处理）
// 7. 返回 unified diff（供 LLM 审视改动；大文件跳过时返回写入摘要）

import { t } from '../../../../core/i18n';
import { ServiceNames } from '../../../../core/types';
import { existsSync, statSync } from 'node:fs';
import { resolveWithinCwd } from '../../../../utils/fs';
import type { FileHistoryService } from '../../../contracts';
import type { ToolContext, ToolResult } from '../../types';
import { writeText, type WriteTextResult } from './handlers/text';

interface WriteParams {
  path: string;
  content: string;
  createDirs?: boolean;
}

function getFileHistory(ctx: ToolContext): FileHistoryService | null {
  return ctx.services.tryResolve<FileHistoryService>(ServiceNames.FILE_HISTORY);
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = params as WriteParams;

    // 1. 基础参数校验
    if (!p.path) {
      return errorResult('path is required');
    }
    if (typeof p.content !== 'string') {
      return errorResult('content must be a string');
    }

    // 2. 路径解析与越权检测
    const absPath = resolveWithinCwd(p.path, ctx.cwd);
    if (!absPath) {
      return errorResult(`path "${p.path}" escapes working directory`);
    }

    // 3. 路径类型预检查：若已存在且是目录则拒绝
    const fileExists = existsSync(absPath);
    if (fileExists) {
      try {
        if (statSync(absPath).isDirectory()) {
          return { content: [{ type: 'text', text: `Error: ${t('tools.pathIsDirectory', { path: absPath })}` }], isError: true };
        }
      } catch { /* stat 失败不阻断 */ }
    }

    // 4. 从 toolConfig 读取配置（无大小限制，write 不需要）
    const toolConfig = (ctx.toolConfig ?? {}) as {
      trackHistory?: boolean;
      requireReadBeforeOverwrite?: boolean;
    };
    const trackHistory = toolConfig.trackHistory ?? true;
    const requireReadBeforeOverwrite = toolConfig.requireReadBeforeOverwrite ?? true;

    // 5. read-before-overwrite 强制校验
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

    // 6. Track Edit：改前备份（同步阻塞，必须在写入前完成）
    const createDirs = p.createDirs ?? true;
    let trackResult: Awaited<ReturnType<FileHistoryService['trackEdit']>> | null = null;
    if (trackHistory && fileHistory) {
      try {
        trackResult = await fileHistory.trackEdit(ctx.sessionId, absPath, ctx.toolCallId, 'write');
      } catch (err) {
        ctx.logger.warn('write: trackEdit failed, undo will be unavailable', {
          path: absPath, error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 7. 分派到 handler 执行流式写入 + diff + 哈希
    let writeResult: WriteTextResult;
    try {
      writeResult = await writeText({ absPath, content: p.content, fileExists, createDirs });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResult(`Error writing file: ${msg}`);
    }

    // 8. 记录历史条目（写入 transcript）
    if (trackResult && fileHistory) {
      try {
        fileHistory.recordChange(
          ctx.sessionId, absPath, trackResult, writeResult.hash, writeResult.bytes,
          writeResult.diff ?? undefined,
        );
      } catch (err) {
        ctx.logger.warn('write: recordChange failed', { path: absPath, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // 9. 返回丰富结果
    ctx.logger.info(t('tools.fileWritten', { path: absPath }), { bytes: writeResult.bytes, operation: writeResult.operation });

    const summary = `Successfully ${writeResult.operation === 'create' ? 'created' : 'overwrote'} ${absPath} (${writeResult.bytes} bytes)`;
    const diffSection = writeResult.diff ? `\n\n--- unified diff ---\n${writeResult.diff}` : '';
    const backupNote = trackResult?.backedUp ? `\n[backup created: ${trackResult.backupPath}]` : '';

    return {
      content: [{ type: 'text', text: summary + diffSection + backupNote }],
      metadata: {
        path: absPath,
        bytes: writeResult.bytes,
        operation: writeResult.operation,
        createdDirs: createDirs,
        diff: writeResult.diff || undefined,
        hashBefore: trackResult?.hash || null,
        hashAfter: writeResult.hash,
        entryId: trackResult?.entryId || null,
        backedUp: trackResult?.backedUp ?? false,
      },
    };
  },
};
