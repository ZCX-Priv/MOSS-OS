// src/modules/agent/session-truncate.test.ts
// 撤回窗口栈式化测试：嵌套撤回 + 栈序逐层恢复（内层保持撤回状态）、
// locate 排除已删除消息（防重复撤回）、旧 lastTruncation 单对象格式加载兼容。

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Logger, Environment } from '../../core/types';
import { SessionStore, type Session } from './session';
import type { AgentMessage } from '../contracts';

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
  dataDir = mkdtempSync(join(tmpdir(), 'moss-truncate-test-'));
});

afterEach(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows 偶发句柄延迟释放
  }
});

function makeStore(): SessionStore {
  return new SessionStore({ dataDir } as Environment, logger, { resolveGroupId: () => 'test' });
}

/** 构造带时间戳的消息 */
function msg(role: AgentMessage['role'], content: string, ts: string): AgentMessage {
  return { role, content, timestamp: ts } as AgentMessage;
}

const T = {
  m1: '2026-01-01T00:00:00.000Z',
  a1: '2026-01-01T00:00:01.000Z',
  m2: '2026-01-01T00:00:02.000Z',
  a2: '2026-01-01T00:00:03.000Z',
  m3: '2026-01-01T00:00:04.000Z',
};

/** 造一个含 3 轮对话的 session */
function makeSession(store: SessionStore): Session {
  const session = store.getOrCreate('s1');
  session.messages.push(
    msg('user', 'm1', T.m1),
    msg('assistant', 'a1', T.a1),
    msg('user', 'm2', T.m2),
    msg('assistant', 'a2', T.a2),
    msg('user', 'm3', T.m3),
  );
  return session;
}

describe('撤回窗口栈式化', () => {
  it('嵌套撤回 + 栈序逐层恢复：先撤 M3 再撤 M2，恢复 M2 窗口时 M3 一并复活，更早消息不受影响', () => {
    const store = makeStore();
    const session = makeSession(store);

    // 撤回 M3（窗口 W1：before = m3.timestamp）
    const idx3 = store.locateUserMessage(session, T.m3, 'm3');
    expect(idx3).toBe(4);
    expect(store.truncateFrom(session, idx3)).toBe(1); // m3
    session.lastTruncations = [{ truncatedBeforeTimestamp: T.m3, rollbackEntryIds: ['r1'] }];

    // 撤回 M2（窗口 W2：before = m2.timestamp；m3 已软删除不重复标记）
    const idx2 = store.locateUserMessage(session, T.m2, 'm2');
    expect(idx2).toBe(2);
    expect(store.truncateFrom(session, idx2)).toBe(2); // m2 + a2（m3 已删）
    session.lastTruncations.push({ truncatedBeforeTimestamp: T.m2, rollbackEntryIds: ['r2'] });

    // 断言软删除状态：m1/a1 存活；m2/a2/m3 已删
    const deleted = (s: Session) => s.messages.filter(m => m.deletedAt).map(m => m.content);
    expect(deleted(session)).toEqual(['m2', 'a2', 'm3']);

    // —— 恢复栈顶（W2）：仅清除 m2.timestamp 之后的软删除（m2/a2/m3 复活）——
    const w2 = session.lastTruncations.pop()!;
    const restoredCount = store.restoreTruncatedWindow(session, w2.truncatedBeforeTimestamp);
    expect(restoredCount).toBe(3);
    expect(deleted(session)).toEqual([]);

    // —— 恢复栈顶（W1）：m3 已复活，无操作 ——
    const w1 = session.lastTruncations.pop()!;
    expect(store.restoreTruncatedWindow(session, w1.truncatedBeforeTimestamp)).toBe(0);
    expect(session.lastTruncations).toHaveLength(0);
  });

  it('反向嵌套：先撤 M2 再恢复，再撤 M3，各窗口独立正确', () => {
    const store = makeStore();
    const session = makeSession(store);

    // 撤回 M2（W1）
    const idx2 = store.locateUserMessage(session, T.m2, 'm2');
    store.truncateFrom(session, idx2);
    session.lastTruncations = [{ truncatedBeforeTimestamp: T.m2, rollbackEntryIds: [] }];

    // 恢复 W1：m2/a2/m3 全部复活
    const w1 = session.lastTruncations.pop()!;
    expect(store.restoreTruncatedWindow(session, w1.truncatedBeforeTimestamp)).toBe(3);

    // 再撤回 M3（新窗口）
    const idx3 = store.locateUserMessage(session, T.m3, 'm3');
    expect(store.truncateFrom(session, idx3)).toBe(1);
    session.lastTruncations.push({ truncatedBeforeTimestamp: T.m3, rollbackEntryIds: [] });

    // 恢复：仅 m3 复活
    const w3 = session.lastTruncations.pop()!;
    expect(store.restoreTruncatedWindow(session, w3.truncatedBeforeTimestamp)).toBe(1);
    expect(session.messages.every(m => !m.deletedAt)).toBe(true);
  });

  it('locateUserMessage 排除已软删除消息：已删除的 m3 本身不会被命中', () => {
    const store = makeStore();
    const session = makeSession(store);

    const idx = store.locateUserMessage(session, T.m3, 'm3');
    store.truncateFrom(session, idx);

    // m3 已软删除：timestamp 模糊定位（±5 分钟容差）跳过 m3，命中最近的
    // 存活 user 消息 m2 —— 不会返回已删除的 m3 索引（防重复撤回同一条）
    const relocated = store.locateUserMessage(session, T.m3, 'm3');
    expect(relocated).not.toBe(idx);
    expect(relocated).toBe(2); // m2（撤回 m2 起的存活消息，m3 已删不重复处理）
    // m2 未删除 → 精确路径可定位
    expect(store.locateUserMessage(session, T.m2, 'm2')).toBe(2);
  });

  it('旧 lastTruncation 单对象格式：loadFromDisk 自动包装为单元素数组', () => {
    const store = makeStore();
    // 通过私有 sessionFilePath 拿到落盘路径，手工写旧格式 session 文件
    const anyStore = store as unknown as { sessionFilePath: (id: string) => string; loadFromDisk: (id: string) => Session | null };
    const filePath = anyStore.sessionFilePath('s-legacy');
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({
      id: 's-legacy',
      messages: [{ role: 'user', content: 'hi', timestamp: T.m1 }],
      createdAt: T.m1,
      updatedAt: T.m1,
      totalTokens: 0,
      contextFiles: [],
      lastTruncation: {
        truncatedBeforeTimestamp: T.m1,
        deletedIndexes: [],
        rollbackEntryIds: ['r-old'],
      },
    }), 'utf8');

    const loaded = anyStore.loadFromDisk('s-legacy');
    expect(loaded).not.toBeNull();
    // 旧单对象 → 单元素数组（栈）；旧对象多余的 deletedIndexes 字段不影响新类型
    expect(loaded!.lastTruncations).toHaveLength(1);
    expect(loaded!.lastTruncations![0]).toMatchObject({
      truncatedBeforeTimestamp: T.m1,
      rollbackEntryIds: ['r-old'],
    });
  });
});
