// src/modules/file-history/migrate.test.ts
// 目录布局迁移单元测试：旧布局完整迁入、backupPath 前缀重写（含正斜杠/大小写容错）、
// 幂等重入、损坏 JSONL 行容错、新旧并存合并策略、全新安装零操作。

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Logger } from '../../core/types';
import { migrateLegacyLayout } from './migrate';
import { readEntries } from './transcript';
import type { FileHistoryEntry } from './types';

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

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'moss-migrate-test-'));
});

afterEach(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows 偶发句柄延迟释放，清理失败不影响断言结果
  }
});

/** 造一条最小合法 FileHistoryEntry */
function makeEntry(overrides: Partial<FileHistoryEntry>): FileHistoryEntry {
  return {
    id: 'e1',
    sessionId: 's1',
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
  };
}

/** 模拟 appendEntry 的序列化行为写 transcript 文件 */
function writeTranscript(path: string, entries: FileHistoryEntry[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const lines = entries.map(e => JSON.stringify(e).replace(/\n/g, '\\n')).join('\n') + '\n';
  writeFileSync(path, lines, 'utf8');
}

describe('migrateLegacyLayout', () => {
  it('完整旧布局迁移：三目录迁入 + transcript 移入 transcripts/ 并重写 backupPath', () => {
    // 旧布局：backups / trash / ledger 平级 + transcript 散落 file-history 根下
    mkdirSync(join(dataDir, 'backups'));
    writeFileSync(join(dataDir, 'backups', 'abc.bak'), 'backup-content');
    mkdirSync(join(dataDir, 'trash'));
    writeFileSync(join(dataDir, 'trash', 'old.txt'), 'trashed');
    mkdirSync(join(dataDir, 'ledger'));
    writeFileSync(join(dataDir, 'ledger', 's1.json'), '{}');
    writeTranscript(join(dataDir, 'file-history', 's1.jsonl'), [
      makeEntry({ id: 'e1', backupPath: join(dataDir, 'backups', 'abc.bak') }),
    ]);

    const result = migrateLegacyLayout({ dataDir }, logger);

    // 旧平级目录整体消失（rename 零拷贝）
    expect(existsSync(join(dataDir, 'backups'))).toBe(false);
    expect(existsSync(join(dataDir, 'trash'))).toBe(false);
    expect(existsSync(join(dataDir, 'ledger'))).toBe(false);

    // 新位置内容就位
    expect(existsSync(join(dataDir, 'file-history', 'backups', 'abc.bak'))).toBe(true);
    expect(existsSync(join(dataDir, 'file-history', 'trash', 'old.txt'))).toBe(true);
    expect(existsSync(join(dataDir, 'file-history', 'ledger', 's1.json'))).toBe(true);

    // transcript 移入 transcripts/ 且 backupPath 已重写为新前缀
    expect(existsSync(join(dataDir, 'file-history', 's1.jsonl'))).toBe(false);
    const newTranscript = join(dataDir, 'file-history', 'transcripts', 's1.jsonl');
    expect(existsSync(newTranscript)).toBe(true);
    const entries = readEntries(newTranscript);
    expect(entries).toHaveLength(1);
    expect(entries[0].backupPath).toBe(join(dataDir, 'file-history', 'backups', 'abc.bak'));

    // 统计结果
    expect(result.movedDirs).toEqual(['backups', 'trash', 'ledger']);
    expect(result.movedTranscripts).toBe(1);
    expect(result.rewroteEntries).toBe(1);
    expect(result.skipped).toEqual([]);
  });

  it('幂等：二次执行零操作、零变化', () => {
    mkdirSync(join(dataDir, 'backups'));
    writeFileSync(join(dataDir, 'backups', 'a.bak'), 'x');
    migrateLegacyLayout({ dataDir }, logger);

    const second = migrateLegacyLayout({ dataDir }, logger);

    expect(second.movedDirs).toEqual([]);
    expect(second.movedTranscripts).toBe(0);
    expect(second.rewroteEntries).toBe(0);
    expect(second.skipped).toEqual([]);
    expect(existsSync(join(dataDir, 'file-history', 'backups', 'a.bak'))).toBe(true);
  });

  it('损坏 JSONL 行容错：正常行保留并重写，坏行丢弃（与既有重写语义一致）', () => {
    const raw =
      JSON.stringify(makeEntry({ id: 'good', backupPath: join(dataDir, 'backups', 'h1.bak') })) +
      '\n{corrupted json line\n';
    mkdirSync(join(dataDir, 'file-history'));
    writeFileSync(join(dataDir, 'file-history', 's2.jsonl'), raw, 'utf8');
    // 注意：backups 目录并不存在——前缀重写是纯字符串操作，不依赖备份文件在盘

    const result = migrateLegacyLayout({ dataDir }, logger);

    const entries = readEntries(join(dataDir, 'file-history', 'transcripts', 's2.jsonl'));
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('good');
    expect(entries[0].backupPath).toBe(join(dataDir, 'file-history', 'backups', 'h1.bak'));
    expect(result.movedTranscripts).toBe(1);
    expect(result.rewroteEntries).toBe(1);
  });

  it('新旧并存：目录逐项合并、同名保留新位置版本；transcript 同名跳过', () => {
    // 模拟上次迁移中断/用户手动干预：新位置已有部分文件
    mkdirSync(join(dataDir, 'file-history', 'backups'), { recursive: true });
    writeFileSync(join(dataDir, 'file-history', 'backups', 'shared.bak'), 'new-version');
    mkdirSync(join(dataDir, 'backups'));
    writeFileSync(join(dataDir, 'backups', 'shared.bak'), 'old-version');
    writeFileSync(join(dataDir, 'backups', 'only-old.bak'), 'old-only');

    mkdirSync(join(dataDir, 'file-history', 'transcripts'));
    writeFileSync(join(dataDir, 'file-history', 'transcripts', 's1.jsonl'), '{"new":true}\n');
    writeTranscript(join(dataDir, 'file-history', 's1.jsonl'), [makeEntry({})]);

    const result = migrateLegacyLayout({ dataDir }, logger);

    // 同名保留新位置版本，不同名迁入
    expect(readFileSync(join(dataDir, 'file-history', 'backups', 'shared.bak'), 'utf8')).toBe('new-version');
    expect(existsSync(join(dataDir, 'file-history', 'backups', 'only-old.bak'))).toBe(true);
    // transcript 同名跳过：新位置版本原样保留
    expect(readFileSync(join(dataDir, 'file-history', 'transcripts', 's1.jsonl'), 'utf8')).toBe('{"new":true}\n');
    expect(result.skipped).toContain('backups/shared.bak');
    expect(result.skipped).toContain('s1.jsonl');
    // 旧 backups 目录因存在跳过项而保留，下次启动继续幂等处理
    expect(existsSync(join(dataDir, 'backups'))).toBe(true);
  });

  it('全新安装（无旧目录）：零操作', () => {
    const result = migrateLegacyLayout({ dataDir }, logger);

    expect(result.movedDirs).toEqual([]);
    expect(result.movedTranscripts).toBe(0);
    expect(result.rewroteEntries).toBe(0);
    expect(result.skipped).toEqual([]);
  });

  it('backupPath 容错：正斜杠形态重写、null 与外部路径不动', () => {
    // 历史数据可能以 / 形态存储（跨环境拷贝），前缀匹配需兼容
    const fwdOld = join(dataDir, 'backups', 'f.bak').replace(/\\/g, '/');
    const outside = join(dataDir, 'elsewhere', 'x.bak');
    writeTranscript(join(dataDir, 'file-history', 's3.jsonl'), [
      makeEntry({ id: 'fwd', backupPath: fwdOld }),
      makeEntry({ id: 'nullbp', backupPath: null }),
      makeEntry({ id: 'outside', backupPath: outside }),
    ]);

    const result = migrateLegacyLayout({ dataDir }, logger);

    const entries = readEntries(join(dataDir, 'file-history', 'transcripts', 's3.jsonl'));
    expect(entries).toHaveLength(3);
    // 正斜杠前缀重写为平台原生分隔符的新路径
    const fwd = entries.find(e => e.id === 'fwd');
    expect(fwd?.backupPath).toBe(join(dataDir, 'file-history', 'backups', 'f.bak'));
    // null 与非旧前缀路径原样保留
    expect(entries.find(e => e.id === 'nullbp')?.backupPath).toBeNull();
    expect(entries.find(e => e.id === 'outside')?.backupPath).toBe(outside);
    expect(result.rewroteEntries).toBe(1);
  });
});
