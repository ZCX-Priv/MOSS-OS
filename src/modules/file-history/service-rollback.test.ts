// src/modules/file-history/service-rollback.test.ts
// 撤回/恢复标记制回归测试（修复"反复撤回-恢复彻底失灵"的核心用例）：
// 撤回→恢复→再撤回无限循环、条目永不物理删除、undo 失败保留可重试、
// 已回滚条目跳过/拒绝、嵌套区间不重复回滚。

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger, Environment } from '../../core/types';
import { FileHistoryServiceImpl } from './service';
import { readEntries, appendEntry } from './transcript';
import { DEFAULT_FILE_HISTORY_CONFIG } from './types';

const logger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => logger,
  setLevel: () => {},
  getLevel: () => 'info',
};

const SESSION = 's1';

let dataDir: string;
let env: Environment;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'moss-rollback-test-'));
  env = { dataDir } as Environment;
});

afterEach(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows 偶发句柄延迟释放
  }
});

function makeService(): FileHistoryServiceImpl {
  return new FileHistoryServiceImpl(env, logger, { ...DEFAULT_FILE_HISTORY_CONFIG });
}

/** 覆盖全部条目的宽松时间区间（前后各放宽 1 小时） */
function wideRange(): [string, string] {
  const now = Date.now();
  return [new Date(now - 3600_000).toISOString(), new Date(now + 3600_000).toISOString()];
}

/** 造一条最小合法 entry（手工注入用） */
function makeEntry(overrides: Record<string, unknown>): ReturnType<typeof readEntries>[number] {
  return {
    id: 'e-test',
    sessionId: SESSION,
    absPath: '/tmp/f.txt',
    toolCallId: 'c1',
    toolName: 'write',
    timestamp: new Date().toISOString(),
    operation: 'overwrite',
    hashBefore: null,
    hashAfter: null,
    backupPath: null,
    bytesBefore: 0,
    bytesAfter: 0,
    ...overrides,
  } as ReturnType<typeof readEntries>[number];
}

describe('rollbackRange / redoRollback 标记制', () => {
  it('核心回归：撤回→恢复→再撤回→再恢复 无限循环，文件状态与条目始终正确', async () => {
    const svc = makeService();
    const file = join(dataDir, 'loop.txt');

    // 历史：E1=create(v1) → E2=overwrite(v1→v2, 备份 v1)
    const t1 = await svc.track({ sessionId: SESSION, absPath: file, toolName: 'write' });
    writeFileSync(file, 'v1', 'utf8');
    t1.commit({ bytesAfter: 2 });

    const t2 = await svc.track({ sessionId: SESSION, absPath: file, toolName: 'edit' });
    writeFileSync(file, 'v2', 'utf8');
    t2.commit({ bytesAfter: 2 });

    expect(svc.listHistory(SESSION)).toHaveLength(2);

    // —— 循环 1：撤回（E2 逆序恢复 v1，E1 撤销创建删除文件）——
    let [from, to] = wideRange();
    let rb = await svc.rollbackRange(SESSION, from, to);
    expect(rb.failed).toHaveLength(0);
    expect(rb.rollbackIds).toHaveLength(2);
    expect(existsSync(file)).toBe(false); // 文件回到不存在
    // 条目仍在（标记制），且带 rolledBackAt
    const marked = svc.listHistory(SESSION).filter(e => e.toolName !== 'rollback');
    expect(marked).toHaveLength(2);
    expect(marked.every(e => e.rolledBackAt)).toBe(true);
    // R 条目带 rollbackOf 反向引用
    const rEntries = svc.listHistory(SESSION).filter(e => e.toolName === 'rollback');
    expect(rEntries).toHaveLength(2);
    expect(rEntries.every(r => r.rollbackOf)).toBe(true);

    // —— 循环 1：恢复（redo，文件回到 v2）——
    let rr = await svc.redoRollback(SESSION, rb.rollbackIds);
    expect(rr.failed).toHaveLength(0);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('v2');
    // 原始条目标记清除 + R 条目移除（transcript 复活，支持再次撤回）
    expect(svc.listHistory(SESSION)).toHaveLength(2);
    expect(svc.listHistory(SESSION).every(e => !e.rolledBackAt)).toBe(true);

    // —— 循环 2：再撤回（旧版在此失灵：条目已被物理删除，rollbackRange 空转）——
    [from, to] = wideRange();
    rb = await svc.rollbackRange(SESSION, from, to);
    expect(rb.rollbackIds).toHaveLength(2); // 仍有目标可回滚
    expect(existsSync(file)).toBe(false); // 文件再次回到不存在

    // —— 循环 2：再恢复 ——
    rr = await svc.redoRollback(SESSION, rb.rollbackIds);
    expect(rr.failed).toHaveLength(0);
    expect(readFileSync(file, 'utf8')).toBe('v2');
    expect(svc.listHistory(SESSION)).toHaveLength(2); // 条目完整如初
  });

  it('已回滚条目不重复回滚：同区间二次撤回（未 redo）零目标', async () => {
    const svc = makeService();
    const file = join(dataDir, 'f.txt');
    const t = await svc.track({ sessionId: SESSION, absPath: file, toolName: 'write' });
    writeFileSync(file, 'v1', 'utf8');
    t.commit({ bytesAfter: 2 });

    const [from, to] = wideRange();
    const rb1 = await svc.rollbackRange(SESSION, from, to);
    expect(rb1.rollbackIds).toHaveLength(1);

    // 未 redo 直接再次撤回同区间：targets 已带标记 → 空转
    const rb2 = await svc.rollbackRange(SESSION, from, to);
    expect(rb2.rollbackIds).toHaveLength(0);
    expect(rb2.failed).toHaveLength(0);
  });

  it('undo：跳过已回滚条目（消息撤回消费过的条目不参与面板撤销）', async () => {
    const svc = makeService();
    const file = join(dataDir, 'f.txt');
    const t = await svc.track({ sessionId: SESSION, absPath: file, toolName: 'write' });
    writeFileSync(file, 'v1', 'utf8');
    t.commit({ bytesAfter: 2 });

    // 撤回消费该条目
    const [from, to] = wideRange();
    await svc.rollbackRange(SESSION, from, to);

    // undo：无活跃条目可撤（E1 已带标记）
    const undo = await svc.undo(SESSION, 5);
    expect(undo.restored).toHaveLength(0);
    expect(undo.remaining).toBe(0);
    expect(existsSync(file)).toBe(false); // 文件未被 undo 触碰
  });

  it('undo 失败保留条目：备份缺失时条目留在 transcript 可重试', async () => {
    const svc = makeService();
    const file = join(dataDir, 'f.txt');
    writeFileSync(file, 'v1', 'utf8');

    // 手工注入一条 backupPath 指向不存在文件的 overwrite 条目（模拟备份被清理）
    appendEntry(
      join(dataDir, 'file-history', 'transcripts', `${SESSION}.jsonl`),
      makeEntry({ id: 'e-bad', absPath: file, operation: 'overwrite', backupPath: join(dataDir, 'nope.bak') }),
    );

    const undo = await svc.undo(SESSION, 1);
    expect(undo.restored).toHaveLength(0);
    expect(undo.failed).toHaveLength(1);
    expect(undo.failed[0].entryId).toBe('e-bad');
    // 关键断言：失败条目保留在 transcript（旧版 removeLastNEntries 先删后恢复 → 永久丢失）
    expect(svc.listHistory(SESSION).some(e => e.id === 'e-bad')).toBe(true);
  });

  it('restore 单条：拒绝已回滚条目与 R 条目（防状态错乱）', async () => {
    const svc = makeService();
    const file = join(dataDir, 'f.txt');
    const t = await svc.track({ sessionId: SESSION, absPath: file, toolName: 'write' });
    writeFileSync(file, 'v1', 'utf8');
    t.commit({ bytesAfter: 2 });

    const [from, to] = wideRange();
    const rb = await svc.rollbackRange(SESSION, from, to);

    // 已回滚条目：拒绝
    const originalId = svc.listHistory(SESSION).find(e => e.toolName !== 'rollback')!.id;
    const r1 = await svc.restore(SESSION, originalId);
    expect(r1.restored).toHaveLength(0);
    expect(r1.failed[0].error).toContain('already rolled back');

    // R 条目：拒绝
    const r2 = await svc.restore(SESSION, rb.rollbackIds[0]);
    expect(r2.restored).toHaveLength(0);
    expect(r2.failed[0].error).toContain('cannot be restored individually');
  });

  it('rollbackRange Phase 1 备份失败：该条目跳过恢复并上报 failed，其余正常', async () => {
    const svc = makeService();
    const file = join(dataDir, 'f.txt');
    const t = await svc.track({ sessionId: SESSION, absPath: file, toolName: 'write' });
    writeFileSync(file, 'v1', 'utf8');
    t.commit({ bytesAfter: 2 });

    // 注入一条损坏条目：目录归档路径但原路径是文件（createRollbackBackup 走 backupByHash 正常）；
    // 改用 move 条目缺 destPath 之外的另一种失败：absPath 指向已删除文件的 overwrite 条目（备份 readBackup 失败在 restore 阶段）
    // 这里直接构造 restore 阶段失败：backupPath 指向不存在文件
    appendEntry(
      join(dataDir, 'file-history', 'transcripts', `${SESSION}.jsonl`),
      makeEntry({ id: 'e-x', absPath: join(dataDir, 'ghost.txt'), operation: 'overwrite', backupPath: join(dataDir, 'ghost.bak') }),
    );

    const [from, to] = wideRange();
    const rb = await svc.rollbackRange(SESSION, from, to);
    // e-x 恢复失败上报；正常条目成功
    expect(rb.failed.some(f => f.error.includes('ghost') || f.error.includes('backup'))).toBe(true);
    expect(rb.rollbackIds).toHaveLength(1);
    // 失败条目不打标记（保留可重试）
    const ghost = svc.listHistory(SESSION).find(e => e.id === 'e-x');
    expect(ghost?.rolledBackAt).toBeUndefined();
  });
});
