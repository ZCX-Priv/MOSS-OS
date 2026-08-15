// src/modules/tools/builtin/delete/delete.test.ts
// delete 工具全场景单测。
// 覆盖：trash/硬删除/批量/dryRun/路径越权/symlink/根级/dev vault/read-before-delete/递归校验等。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  symlinkSync,
  statSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import deleteTool from './index';
import type { ToolContext, ToolResult } from '../../types';
import type { FileHistoryService } from '../../../contracts';
import type { Logger } from '../../../../core/types';
import type { TrackEditResult, UndoResult, FileHistoryEntry } from '../../../file-history/types';

/** 创建 mock FileHistoryService，readSet 控制已读文件 */
function createMockFileHistory(trashDir: string): FileHistoryService {
  const readSet = new Set<string>();
  const trackEdits: Array<{ absPath: string; isDir: boolean }> = [];
  const records: Array<{ absPath: string; isDir: boolean }> = [];

  const svc: FileHistoryService = {
    isRead: (_sid: string, absPath: string) => readSet.has(absPath),
    markRead: (_sid: string, absPath: string, _sha: string) => {
      readSet.add(absPath);
    },
    trackEdit: async (
      _sid: string,
      absPath: string,
      _callId: string,
      _toolName: 'write' | 'edit' | 'delete',
    ): Promise<TrackEditResult> => {
      const isDir = existsSync(absPath) && statSync(absPath).isDirectory();
      trackEdits.push({ absPath, isDir });
      return {
        backedUp: true,
        backupPath: isDir ? join(trashDir, `${absPath}.tar.gz`) : join(trashDir, 'fake.bak'),
        hash: '',
        bytesBefore: 100,
        entryId: 'fake-entry-id',
        operation: 'delete',
        isDirectory: isDir,
      };
    },
    recordChange: (
      _sid: string,
      absPath: string,
      trackResult: TrackEditResult,
      _hashAfter: string,
      _bytesAfter: number,
      _diff?: string,
    ) => {
      records.push({ absPath, isDir: trackResult.isDirectory ?? false });
    },
    getTrashDir: () => trashDir,
    createSnapshot: async () => {},
    undo: async (): Promise<UndoResult> => ({ restored: [], remaining: 0, failed: [] }),
    listHistory: (): FileHistoryEntry[] => [],
    restore: async (): Promise<UndoResult> => ({ restored: [], remaining: 0, failed: [] }),
    rollbackRange: async () => ({ rollbackIds: [], failed: [] }),
    redoRollback: async () => ({ failed: [] }),
    clearSession: () => {},
  };
  return svc;
}

/** 创建 mock Logger */
function createMockLogger(): Logger {
  const noop = (): void => {};
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as Logger;
}

/** 创建 mock ToolContext */
function createMockCtx(cwd: string, fileHistory: FileHistoryService): ToolContext {
  return {
    sessionId: 'test-session',
    cwd,
    toolCallId: 'test-call-id',
    emit: () => {},
    logger: createMockLogger(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    services: { tryResolve: () => fileHistory } as any,
    confirm: async () => true,
    toolConfig: { trackHistory: true },
  };
}

async function runDelete(
  ctx: ToolContext,
  params: Record<string, unknown>,
): Promise<ToolResult> {
  return deleteTool.execute(params, ctx);
}

describe('delete 工具', () => {
  let workDir: string;
  let trashDir: string;
  let ctx: ToolContext;
  let fileHistory: FileHistoryService;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'moss-delete-test-'));
    trashDir = join(workDir, '.moss', 'trash');
    mkdirSync(trashDir, { recursive: true });
    fileHistory = createMockFileHistory(trashDir);
    ctx = createMockCtx(workDir, fileHistory);
  });

  afterEach(() => {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      // 清理失败忽略
    }
  });

  describe('参数校验', () => {
    it('path 与 paths 同时提供应拒绝', async () => {
      const result = await runDelete(ctx, { path: 'a.txt', paths: ['b.txt'] });
      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({ type: 'text' });
      expect((result.content[0] as { text: string }).text).toContain('mutually exclusive');
    });

    it('path 和 paths 都不提供应拒绝', async () => {
      const result = await runDelete(ctx, { recursive: true });
      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain('required');
    });
  });

  describe('单文件删除', () => {
    it('trash=true（默认）应移到回收站，原路径消失', async () => {
      const filePath = join(workDir, 'test.txt');
      writeFileSync(filePath, 'hello world');
      const result = await runDelete(ctx, { path: 'test.txt' });
      expect(result.isError).toBeUndefined();
      expect(existsSync(filePath)).toBe(false);
      // trash 目录应有文件
      const trashEntries = readdirSync(trashDir).filter((f) => !f.endsWith('.meta.json'));
      expect(trashEntries.length).toBe(1);
      expect(existsSync(join(trashDir, 'test.txt.meta.json'))).toBe(true);
    });

    it('trash=false force=true 应硬删除且备份', async () => {
      const filePath = join(workDir, 'ro.txt');
      writeFileSync(filePath, 'read only content');
      const result = await runDelete(ctx, { path: 'ro.txt', trash: false, force: true });
      expect(result.isError).toBeUndefined();
      expect(existsSync(filePath)).toBe(false);
    });

    it('trash=false force=false 文件未 read 应被 read-before-delete 拒绝', async () => {
      const filePath = join(workDir, 'unread.txt');
      writeFileSync(filePath, 'unread content');
      const result = await runDelete(ctx, { path: 'unread.txt', trash: false, force: false });
      // 由于未 read，应失败
      const meta = result.metadata?.results as Array<{ success: boolean }>;
      expect(meta).toBeDefined();
      expect(meta[0].success).toBe(false);
      expect(existsSync(filePath)).toBe(true); // 未删
    });

    it('trash=false 文件已 read 应硬删除成功', async () => {
      const filePath = join(workDir, 'read.txt');
      writeFileSync(filePath, 'read content');
      fileHistory.markRead(ctx.sessionId, filePath, 'fake-sha');
      const result = await runDelete(ctx, { path: 'read.txt', trash: false });
      const meta = result.metadata?.results as Array<{ success: boolean; hardDeleted: boolean }>;
      expect(meta[0].success).toBe(true);
      expect(meta[0].hardDeleted).toBe(true);
      expect(existsSync(filePath)).toBe(false);
    });
  });

  describe('目录删除', () => {
    it('trash=true 目录应移到回收站', async () => {
      const dirPath = join(workDir, 'mydir');
      mkdirSync(dirPath);
      writeFileSync(join(dirPath, 'a.txt'), 'a');
      const result = await runDelete(ctx, { path: 'mydir', recursive: true });
      const meta = result.metadata?.results as Array<{ success: boolean; trashed: boolean }>;
      expect(meta[0].success).toBe(true);
      expect(meta[0].trashed).toBe(true);
      expect(existsSync(dirPath)).toBe(false);
    });

    it('trash=false force=true recursive=true 应硬删除且归档备份', async () => {
      const dirPath = join(workDir, 'archivedir');
      mkdirSync(dirPath);
      writeFileSync(join(dirPath, 'a.txt'), 'content a');
      writeFileSync(join(dirPath, 'b.txt'), 'content b');
      const result = await runDelete(ctx, {
        path: 'archivedir',
        recursive: true,
        trash: false,
        force: true,
      });
      const meta = result.metadata?.results as Array<{
        success: boolean;
        hardDeleted: boolean;
        backedUp: boolean;
        isDirectory: boolean;
      }>;
      expect(meta[0].success).toBe(true);
      expect(meta[0].hardDeleted).toBe(true);
      expect(meta[0].backedUp).toBe(true);
      expect(meta[0].isDirectory).toBe(true);
      expect(existsSync(dirPath)).toBe(false);
    });

    it('目录删除缺少 recursive 应拒绝', async () => {
      const dirPath = join(workDir, 'needrecursive');
      mkdirSync(dirPath);
      const result = await runDelete(ctx, { path: 'needrecursive', trash: false, force: true });
      const meta = result.metadata?.results as Array<{ success: boolean }>;
      expect(meta[0].success).toBe(false);
      expect(existsSync(dirPath)).toBe(true);
    });
  });

  describe('批量删除', () => {
    it('paths 数组应批量删除', async () => {
      const f1 = join(workDir, 'b1.txt');
      const f2 = join(workDir, 'b2.txt');
      writeFileSync(f1, '1');
      writeFileSync(f2, '2');
      const result = await runDelete(ctx, { paths: ['b1.txt', 'b2.txt'] });
      const summary = result.metadata?.summary as {
        total: number;
        success: number;
        trashed: number;
      };
      expect(summary.total).toBe(2);
      expect(summary.success).toBe(2);
      expect(summary.trashed).toBe(2);
      expect(existsSync(f1)).toBe(false);
      expect(existsSync(f2)).toBe(false);
    });
  });

  describe('dryRun 预演模式', () => {
    it('dryRun=true 不应有副作用，返回清单', async () => {
      const filePath = join(workDir, 'dry.txt');
      writeFileSync(filePath, 'dry content');
      const result = await runDelete(ctx, { path: 'dry.txt', dryRun: true });
      expect(result.metadata?.dryRun).toBe(true);
      const wouldDelete = result.metadata?.wouldDelete as Array<{
        path: string;
        type: string;
      }>;
      expect(wouldDelete.length).toBe(1);
      expect(wouldDelete[0].type).toBe('file');
      expect(existsSync(filePath)).toBe(true); // 未删
    });
  });

  describe('安全校验', () => {
    it('路径越权（../）应拒绝', async () => {
      const result = await runDelete(ctx, { path: '../../../etc/passwd', trash: false, force: true });
      const meta = result.metadata?.results as Array<{ success: boolean; message: string }>;
      expect(meta[0].success).toBe(false);
      expect(meta[0].message).toContain('escapes working directory');
    });

    it('路径不存在应拒绝', async () => {
      const result = await runDelete(ctx, { path: 'nonexistent.txt' });
      const meta = result.metadata?.results as Array<{ success: boolean; message: string }>;
      expect(meta[0].success).toBe(false);
      expect(meta[0].message).toContain('not found');
    });

    it('Windows 根级路径应被 isRootPath 检测（根级路径必然越权，由越权防护先拦截）', async () => {
      // 直接验证 isRootPath 函数（根级路径不在 cwd 内，delete 工具会先被越权防护拦截）
      const { isRootPath } = await import('../../../../utils/fs');
      const rootPath = process.platform === 'win32' ? 'C:\\' : '/';
      expect(isRootPath(rootPath)).toBe(true);
      expect(isRootPath(join(workDir, 'file.txt'))).toBe(false);
    });

    it('dev vault（含 .git）应拒绝，force=true 可绕过', async () => {
      const gitDir = join(workDir, 'vault');
      mkdirSync(gitDir);
      mkdirSync(join(gitDir, '.git'));
      writeFileSync(join(gitDir, 'secret.txt'), 'secret');

      // 非 force 应拒绝
      const r1 = await runDelete(ctx, {
        path: 'vault',
        recursive: true,
        trash: false,
        force: false,
      });
      const meta1 = r1.metadata?.results as Array<{ success: boolean; message: string }>;
      expect(meta1[0].success).toBe(false);
      expect(meta1[0].message).toContain('dev vault');
      expect(existsSync(gitDir)).toBe(true);

      // force=true 应成功
      const r2 = await runDelete(ctx, {
        path: 'vault',
        recursive: true,
        trash: false,
        force: true,
      });
      const meta2 = r2.metadata?.results as Array<{ success: boolean }>;
      expect(meta2[0].success).toBe(true);
      expect(existsSync(gitDir)).toBe(false);
    });

    it('symlink 遍历应拒绝（若系统支持创建 symlink）', async () => {
      // 创建 cwd 外的目标文件
      const outsideTarget = join(tmpdir(), 'moss-outside-target.txt');
      writeFileSync(outsideTarget, 'outside');
      // 在 cwd 内创建 symlink 指向 cwd 外
      const linkPath = join(workDir, 'evil-link.txt');
      let symlinkCreated = false;
      try {
        // Windows 需要 type 参数（'file'），POSIX 可省略但传了也无害
        symlinkSync(outsideTarget, linkPath, 'file');
        symlinkCreated = true;
      } catch {
        // Windows 非管理员或未开启开发者模式时创建 symlink 失败，跳过
      }

      if (!symlinkCreated) {
        // 清理并跳过
        if (existsSync(outsideTarget)) rmSync(outsideTarget, { force: true });
        return;
      }

      const result = await runDelete(ctx, {
        path: 'evil-link.txt',
        trash: false,
        force: true,
      });
      const meta = result.metadata?.results as Array<{ success: boolean; message: string }>;
      expect(meta[0].success).toBe(false);
      expect(meta[0].message).toContain('symlink');

      // 清理
      if (existsSync(outsideTarget)) rmSync(outsideTarget, { force: true });
    });
  });

  describe('read-before-delete（文件）', () => {
    it('trash=true 时 read-before-delete 不强制（trash 模式安全）', async () => {
      const filePath = join(workDir, 'notread.txt');
      writeFileSync(filePath, 'content');
      // 不 markRead，trash=true 默认
      const result = await runDelete(ctx, { path: 'notread.txt' });
      const meta = result.metadata?.results as Array<{ success: boolean }>;
      expect(meta[0].success).toBe(true);
    });

    it('trash=false force=true 跳过 read-before-delete', async () => {
      const filePath = join(workDir, 'force.txt');
      writeFileSync(filePath, 'content');
      const result = await runDelete(ctx, { path: 'force.txt', trash: false, force: true });
      const meta = result.metadata?.results as Array<{ success: boolean }>;
      expect(meta[0].success).toBe(true);
      expect(existsSync(filePath)).toBe(false);
    });
  });

  describe('trash 回收站功能', () => {
    it('同名文件 trash 应追加时间戳后缀防冲突', async () => {
      const f1 = join(workDir, 'dup.txt');
      const f2 = join(workDir, 'sub', 'dup.txt');
      mkdirSync(join(workDir, 'sub'));
      writeFileSync(f1, 'first');
      writeFileSync(f2, 'second');

      // 先 trash 第一个
      await runDelete(ctx, { path: 'dup.txt' });
      // 再 trash 第二个（同名）
      await runDelete(ctx, { path: 'sub/dup.txt' });

      const trashEntries = readdirSync(trashDir).filter((f) => f.endsWith('.txt'));
      expect(trashEntries.length).toBe(2);
      // 第二个应有时间戳后缀
      const hasTimestamp = trashEntries.some((f) => f.includes('dup_') && f.endsWith('.txt'));
      expect(hasTimestamp).toBe(true);
    });

    it('trash 后 sidecar meta.json 应存在且记录原路径', async () => {
      const filePath = join(workDir, 'meta.txt');
      writeFileSync(filePath, 'content');
      await runDelete(ctx, { path: 'meta.txt' });
      const metaPath = join(trashDir, 'meta.txt.meta.json');
      expect(existsSync(metaPath)).toBe(true);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(meta.originalPath).toBe(filePath);
      expect(meta.trashedAt).toBeDefined();
    });
  });
});
