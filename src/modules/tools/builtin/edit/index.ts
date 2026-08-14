// builtin/edit/index.ts
// edit 工具 execute 逻辑：精确字符串匹配替换，支持三种模式：
//   A. 单次替换（path+oldString+newString，向后兼容）
//   B. 单文件批量（path+edits，顺序应用，预校验全通过才原子写入）
//   C. 多文件批量（files，文件级独立原子：失败文件跳过，其余照常）
// 强化点：
//   1. 多级模糊容错（exact → eol → indent → trailing-ws），命中即应用并标注级别
//   2. sha256 乐观锁（expectHash 防并发覆盖）
//   3. dryRun 预览
//   4. read-before-overwrite + trackEdit 哈希备份 + 原子写入 + diff 返回
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
import type { TrackEditResult } from '../../../file-history/types';
import type { ToolContext, ToolResult } from '../../types';

// ============================================================================
// 类型定义
// ============================================================================

interface SingleEdit {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

interface FileEdit {
  path: string;
  edits: SingleEdit[];
}

interface EditToolConfig {
  trackHistory: boolean;
  requireReadBeforeOverwrite: boolean;
  requireHashMatch: boolean;
  fuzzyMatch: boolean;
  maxEditsPerFile: number;
  maxFiles: number;
}

type FuzzyLevel = 'exact' | 'eol' | 'indent' | 'trailing-ws';

interface FuzzyLocateResult {
  /** 在原 content 上的起始偏移（仅用于 replaceAll=false 时定位，实际替换用 alignedOld） */
  start: number;
  end: number;
  /** 对齐后的搜索串；用它 split/join 或 replace 在原 content 上精确替换 */
  alignedOld: string;
  level: FuzzyLevel;
  /** 匹配次数（replaceAll 时为全部出现次数） */
  count: number;
}

interface PerEditResult {
  replacements: number;
  fuzzyLevel: FuzzyLevel;
}

interface ApplyResult {
  ok: boolean;
  newContent?: string;
  perEdit?: PerEditResult[];
  failedEditIndex?: number;
  error?: string;
}

interface EditOneFileResult {
  ok: boolean;
  path: string;
  replacements: number;
  perEdit: PerEditResult[];
  fuzzyLevels: FuzzyLevel[];
  diff?: string;
  hashBefore?: string;
  hashAfter?: string;
  expectHash?: string;
  hashMatched?: boolean;
  entryId?: string | null;
  backedUp?: boolean;
  dryRun?: boolean;
  error?: string;
}

// ============================================================================
// 辅助函数
// ============================================================================

function getFileHistory(ctx: ToolContext): FileHistoryService | null {
  return ctx.services.tryResolve<FileHistoryService>(ServiceNames.FILE_HISTORY);
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

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

/** 检测文件主导行尾风格 */
function detectEol(content: string): 'crlf' | 'lf' {
  const crlfCount = countOccurrences(content, '\r\n');
  if (crlfCount === 0) return 'lf';
  const lfCount = countOccurrences(content, '\n');
  // CRLF 占多数（>= 一半）即视为 CRLF 文件
  return crlfCount * 2 >= lfCount ? 'crlf' : 'lf';
}

/** 转义正则特殊字符 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 多级模糊容错定位。逐级尝试，命中即返回（用 alignedOld 在原 content 上精确替换）。
 * - replaceAll=false 时要求唯一匹配，否则视为未找到
 * - 全部级别失败返回 null
 */
function fuzzyLocate(
  content: string,
  oldString: string,
  fuzzyEnabled: boolean,
  replaceAll: boolean,
): FuzzyLocateResult | null {
  // Level 0: exact
  const exactCount = countOccurrences(content, oldString);
  if (exactCount > 0 && (replaceAll || exactCount === 1)) {
    const idx = content.indexOf(oldString);
    return {
      start: idx,
      end: idx + oldString.length,
      alignedOld: oldString,
      level: 'exact',
      count: exactCount,
    };
  }

  if (!fuzzyEnabled) return null;

  // Level 1: EOL 对齐（CRLF <-> LF）
  const fileEol = detectEol(content);
  let eolAligned = oldString;
  if (fileEol === 'crlf' && !oldString.includes('\r\n')) {
    eolAligned = oldString.replace(/\r?\n/g, '\r\n');
  } else if (fileEol === 'lf' && oldString.includes('\r\n')) {
    eolAligned = oldString.replace(/\r\n/g, '\n');
  }
  if (eolAligned !== oldString) {
    const c = countOccurrences(content, eolAligned);
    if (c > 0 && (replaceAll || c === 1)) {
      const idx = content.indexOf(eolAligned);
      return { start: idx, end: idx + eolAligned.length, alignedOld: eolAligned, level: 'eol', count: c };
    }
  }

  // Level 2: 缩进 tab <-> space 对齐（仅行首）
  // 生成两个候选：行首 tab→2空格、行首 2空格→tab，分别精确匹配
  const tabToSpace = oldString.replace(/^(\t+)/gm, (m) => m.replace(/\t/g, '  '));
  const spaceToTab = oldString.replace(/^( +)/gm, (m) => m.replace(/  /g, '\t'));
  for (const aligned of [tabToSpace, spaceToTab]) {
    if (aligned === oldString) continue;
    const c = countOccurrences(content, aligned);
    if (c > 0 && (replaceAll || c === 1)) {
      const idx = content.indexOf(aligned);
      return { start: idx, end: idx + aligned.length, alignedOld: aligned, level: 'indent', count: c };
    }
  }

  // Level 3: 行尾空白归一化
  // oldString 每行转义后行尾允许匹配任意尾部空白 [ \t]*
  try {
    const lines = oldString.split('\n');
    const regexSrc = lines.map((l) => escapeRegExp(l) + '[ \\t]*').join('\\n');
    const re = new RegExp(regexSrc, 'g');
    const matches = Array.from(content.matchAll(re));
    if (matches.length > 0 && (replaceAll || matches.length === 1)) {
      const m = matches[0];
      const idx = m.index ?? -1;
      if (idx >= 0) {
        const aligned = m[0];
        return {
          start: idx,
          end: idx + aligned.length,
          alignedOld: aligned,
          level: 'trailing-ws',
          count: matches.length,
        };
      }
    }
  } catch {
    // 正则构造失败，跳过该级别
  }

  return null;
}

/**
 * 在 content 上顺序应用 edits（模拟，预校验）。
 * 任一 edit 的 oldString 找不到/不唯一 → 立即返回失败，不修改内容。
 * edit[N] 在 edit[N-1] 修改后的内容上查找。
 */
function applyEditsOnContent(
  content: string,
  edits: SingleEdit[],
  fuzzyEnabled: boolean,
): ApplyResult {
  let current = content;
  const perEdit: PerEditResult[] = [];

  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    if (typeof e.oldString !== 'string' || typeof e.newString !== 'string') {
      return { ok: false, failedEditIndex: i, error: `edit[${i}]: oldString and newString must be strings` };
    }
    if (e.oldString === e.newString) {
      return { ok: false, failedEditIndex: i, error: `edit[${i}]: oldString and newString are identical` };
    }
    if (e.oldString === '') {
      return { ok: false, failedEditIndex: i, error: `edit[${i}]: oldString cannot be empty` };
    }
    const replaceAll = e.replaceAll ?? false;
    const loc = fuzzyLocate(current, e.oldString, fuzzyEnabled, replaceAll);
    if (!loc) {
      const occ = countOccurrences(current, e.oldString);
      const reason = occ === 0 ? 'not found' : `not unique (${occ} occurrences)`;
      return { ok: false, failedEditIndex: i, error: `edit[${i}]: oldString ${reason}` };
    }
    if (replaceAll) {
      current = current.split(loc.alignedOld).join(e.newString);
      perEdit.push({ replacements: loc.count, fuzzyLevel: loc.level });
    } else {
      current = current.replace(loc.alignedOld, e.newString);
      perEdit.push({ replacements: 1, fuzzyLevel: loc.level });
    }
  }

  return { ok: true, newContent: current, perEdit };
}

// ============================================================================
// 单文件完整编辑流程
// ============================================================================

async function editOneFile(
  fileEdit: FileEdit,
  expectHash: string | undefined,
  dryRun: boolean,
  ctx: ToolContext,
  toolConfig: EditToolConfig,
): Promise<EditOneFileResult> {
  const { path: rawPath, edits } = fileEdit;
  const result: EditOneFileResult = {
    ok: false,
    path: rawPath,
    replacements: 0,
    perEdit: [],
    fuzzyLevels: [],
  };

  // 1. 路径解析
  const absPath = resolveWithinCwd(rawPath, ctx.cwd);
  if (!absPath) {
    result.error = `path "${rawPath}" escapes working directory`;
    return result;
  }
  result.path = absPath;

  // 2. 存在性
  if (!existsSync(absPath)) {
    result.error = `file not found: ${absPath}`;
    return result;
  }

  // 3. 目录检测
  try {
    if (statSync(absPath).isDirectory()) {
      result.error = t('tools.pathIsDirectory', { path: absPath });
      return result;
    }
  } catch {
    // stat 失败不阻断，后续读取会抛错
  }

  // 4. read-before-overwrite
  const fileHistory = getFileHistory(ctx);
  if (toolConfig.requireReadBeforeOverwrite && fileHistory) {
    if (!fileHistory.isRead(ctx.sessionId, absPath)) {
      result.error = `${t('tools.readBeforeOverwriteRequired', { path: absPath })}\n请先调用 read 工具读取该文件，再执行 edit。`;
      return result;
    }
  }

  // 5. 读文件（BOM 检测/剥离）
  let content: string;
  let hadBom = false;
  try {
    const rawBuf = readFileSync(absPath);
    hadBom = hasUtf8Bom(rawBuf);
    content = stripBom(rawBuf.toString('utf8'));
  } catch (err) {
    result.error = `Error reading file: ${err instanceof Error ? err.message : err}`;
    return result;
  }

  // 6. expectHash 乐观锁
  const actualHashBefore = sha256(content);
  result.hashBefore = actualHashBefore;
  result.expectHash = expectHash;
  if (expectHash !== undefined) {
    if (expectHash !== actualHashBefore) {
      result.error = t('tools.hashMismatch', { path: absPath });
      result.hashMatched = false;
      return result;
    }
    result.hashMatched = true;
  } else {
    if (toolConfig.requireHashMatch) {
      ctx.logger.warn(t('tools.expectHashMissing'), { path: absPath });
    }
    result.hashMatched = false;
  }

  // 7. 模拟应用 edits（预校验）
  const applyResult = applyEditsOnContent(content, edits, toolConfig.fuzzyMatch);
  if (!applyResult.ok || !applyResult.newContent) {
    const idx = (applyResult.failedEditIndex ?? 0) + 1;
    result.error = `${t('tools.batchEditFailed', { index: idx, level: 'none', path: absPath })}\n${applyResult.error}`;
    return result;
  }
  const newContent = applyResult.newContent;
  result.perEdit = applyResult.perEdit ?? [];
  result.replacements = result.perEdit.reduce((s, e) => s + e.replacements, 0);
  result.fuzzyLevels = result.perEdit.map((e) => e.fuzzyLevel);

  // 8. dryRun：只返回 diff 不写入
  if (dryRun) {
    const diff = computeLineDiff(content, newContent);
    result.ok = true;
    result.dryRun = true;
    result.diff = diff || undefined;
    result.hashAfter = sha256(newContent);
    return result;
  }

  // 9. trackEdit 备份（改前哈希）
  let trackResult: TrackEditResult | null = null;
  if (toolConfig.trackHistory && fileHistory) {
    try {
      trackResult = await fileHistory.trackEdit(ctx.sessionId, absPath, ctx.toolCallId, 'edit');
    } catch (err) {
      ctx.logger.warn('edit: trackEdit failed, undo will be unavailable', {
        path: absPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 10. 原子写入（保留 BOM，沿用原双写逻辑）
  try {
    atomicWriteFile(absPath, newContent, { fsync: true, preserveBom: false, preserveMode: true });
    if (hadBom) {
      atomicWriteFile(absPath, '\uFEFF' + newContent, { fsync: true, preserveBom: false, preserveMode: true });
    }
  } catch (err) {
    result.error = `Error writing file: ${err instanceof Error ? err.message : err}`;
    return result;
  }

  // 11. diff
  const diff = computeLineDiff(content, newContent);
  result.diff = diff || undefined;
  result.hashAfter = sha256(newContent);
  result.entryId = trackResult?.entryId ?? null;
  result.backedUp = trackResult?.backedUp ?? false;
  result.ok = true;

  // 12. recordChange（写入 transcript）
  if (trackResult && fileHistory) {
    try {
      fileHistory.recordChange(
        ctx.sessionId,
        absPath,
        trackResult,
        result.hashAfter,
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

  ctx.logger.info(t('tools.fileEdited', { path: absPath }), { replacements: result.replacements });

  return result;
}

// ============================================================================
// 主入口
// ============================================================================

export default {
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const p = params as {
      path?: string;
      oldString?: string;
      newString?: string;
      replaceAll?: boolean;
      edits?: SingleEdit[];
      files?: { path: string; edits: SingleEdit[] }[];
      expectHash?: string;
      dryRun?: boolean;
    };

    // 读取配置
    const cfg = (ctx.toolConfig ?? {}) as Partial<EditToolConfig>;
    const toolConfig: EditToolConfig = {
      trackHistory: cfg.trackHistory ?? true,
      requireReadBeforeOverwrite: cfg.requireReadBeforeOverwrite ?? true,
      requireHashMatch: cfg.requireHashMatch ?? true,
      fuzzyMatch: cfg.fuzzyMatch ?? true,
      maxEditsPerFile: cfg.maxEditsPerFile ?? 50,
      maxFiles: cfg.maxFiles ?? 20,
    };

    // 参数归一化为 FileEdit[]
    let fileEdits: FileEdit[];
    let expectHash: string | undefined;

    if (p.files && p.files.length > 0) {
      // 模式 C：多文件批量
      if (p.files.length > toolConfig.maxFiles) {
        return {
          content: [{ type: 'text', text: `Error: files array exceeds maxFiles (${toolConfig.maxFiles})` }],
          isError: true,
        };
      }
      fileEdits = p.files.map((f) => ({ path: f.path, edits: f.edits }));
      expectHash = undefined; // 多文件模式不支持顶层 expectHash（每文件哈希不同）
    } else if (p.path && p.edits && p.edits.length > 0) {
      // 模式 B：单文件批量
      if (p.edits.length > toolConfig.maxEditsPerFile) {
        return {
          content: [{ type: 'text', text: `Error: edits array exceeds maxEditsPerFile (${toolConfig.maxEditsPerFile})` }],
          isError: true,
        };
      }
      fileEdits = [{ path: p.path, edits: p.edits }];
      expectHash = p.expectHash;
    } else if (p.path && typeof p.oldString === 'string' && typeof p.newString === 'string') {
      // 模式 A：单次替换（向后兼容）
      fileEdits = [{
        path: p.path,
        edits: [{ oldString: p.oldString, newString: p.newString, replaceAll: p.replaceAll }],
      }];
      expectHash = p.expectHash;
    } else {
      return {
        content: [{ type: 'text', text: 'Error: must provide (path+oldString+newString) or (path+edits) or (files)' }],
        isError: true,
      };
    }

    // 基础校验
    for (const fe of fileEdits) {
      if (!fe.path) {
        return { content: [{ type: 'text', text: 'Error: path is required' }], isError: true };
      }
      for (const e of fe.edits) {
        if (typeof e.oldString !== 'string' || typeof e.newString !== 'string') {
          return { content: [{ type: 'text', text: 'Error: oldString and newString must be strings' }], isError: true };
        }
      }
    }

    const dryRun = p.dryRun ?? false;

    // 单文件快速路径
    if (fileEdits.length === 1) {
      const r = await editOneFile(fileEdits[0], expectHash, dryRun, ctx, toolConfig);
      if (!r.ok) {
        return { content: [{ type: 'text', text: `Error: ${r.error}` }], isError: true };
      }
      const nonExactLevels = r.fuzzyLevels.filter((l) => l !== 'exact');
      const fuzzyNote = nonExactLevels.length > 0
        ? `\n[${t('tools.fuzzyMatchUsed', { level: nonExactLevels.join(',') })}]`
        : '';
      const summary = r.dryRun
        ? `${t('tools.dryRunPreview')}: ${r.path} (${r.replacements} replacement${r.replacements > 1 ? 's' : ''})`
        : `Successfully edited ${r.path} (${r.replacements} replacement${r.replacements > 1 ? 's' : ''})`;
      const diffSection = r.diff ? `\n\n--- unified diff ---\n${r.diff}` : '';
      const backupNote = r.backedUp && r.entryId ? `\n[backup created, entryId: ${r.entryId}]` : '';

      return {
        content: [{ type: 'text', text: summary + fuzzyNote + diffSection + backupNote }],
        metadata: {
          path: r.path,
          replacements: r.replacements,
          perEdit: r.perEdit,
          fuzzyLevels: r.fuzzyLevels,
          diff: r.diff || undefined,
          hashBefore: r.hashBefore || null,
          hashAfter: r.hashAfter || null,
          expectHash: r.expectHash || null,
          hashMatched: r.hashMatched ?? false,
          entryId: r.entryId || null,
          backedUp: r.backedUp ?? false,
          dryRun: r.dryRun ?? false,
        },
      };
    }

    // 多文件模式：文件级独立原子
    const results: EditOneFileResult[] = [];
    for (const fe of fileEdits) {
      const r = await editOneFile(fe, undefined, dryRun, ctx, toolConfig);
      results.push(r);
    }

    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    if (succeeded.length === 0) {
      const lines = [t('tools.multiEditAllFailed')];
      for (const r of failed) {
        lines.push(`  - ${r.path}: ${r.error}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }], isError: true };
    }

    const lines: string[] = [];
    if (failed.length > 0) {
      lines.push(t('tools.multiEditPartialFailure', { failed: failed.length, success: succeeded.length }));
    } else {
      lines.push(`Successfully edited ${succeeded.length} file(s).`);
    }
    lines.push('');
    lines.push('Succeeded:');
    for (const r of succeeded) {
      const nonExact = r.fuzzyLevels.filter((l) => l !== 'exact');
      const fuzzy = nonExact.length > 0 ? ` [fuzzy: ${nonExact.join(',')}]` : '';
      const dryTag = r.dryRun ? ' [dry-run]' : '';
      lines.push(`  - ${r.path} (${r.replacements} replacement${r.replacements > 1 ? 's' : ''})${fuzzy}${dryTag}`);
      if (r.diff) {
        lines.push('    --- diff ---');
        lines.push(r.diff.split('\n').map((l) => '    ' + l).join('\n'));
      }
    }
    if (failed.length > 0) {
      lines.push('');
      lines.push('Failed:');
      for (const r of failed) {
        lines.push(`  - ${r.path}: ${r.error}`);
      }
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      metadata: {
        files: results.map((r) => ({
          path: r.path,
          ok: r.ok,
          replacements: r.replacements,
          fuzzyLevels: r.fuzzyLevels,
          hashAfter: r.hashAfter || null,
          error: r.error || undefined,
        })),
        succeeded: succeeded.length,
        failed: failed.length,
        dryRun,
      },
    };
  },
};
