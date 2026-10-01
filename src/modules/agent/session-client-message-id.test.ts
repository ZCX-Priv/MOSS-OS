// src/modules/agent/session-client-message-id.test.ts
// 用户消息身份（clientMessageId）持久化测试：
//   1. 传入时随用户消息落盘，并从同一 dataDir 重新加载后仍存在（跨刷新对齐的关键）
//   2. 未传入时不写入该字段（保持旧数据紧凑）
//   3. 与附件结构化字段共存（附件 + 身份同时往返）
//   4. 非用户消息（assistant/tool）不受影响、不会带上该字段

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger, Environment } from '../../core/types';
import { SessionStore } from './session';

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
  dataDir = mkdtempSync(join(tmpdir(), 'moss-clientmsg-test-'));
});

afterEach(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows 偶发句柄延迟释放
  }
});

function makeStore(): SessionStore {
  return new SessionStore({ dataDir } as Environment, logger, { resolveSessionDir: () => 'test' });
}

/** 直接读磁盘 JSON（不经 SessionStore，排除内存缓存掩盖问题） */
function readPersisted(sid: string): {
  messages: Array<{ role: string; content: string; clientMessageId?: string; attachments?: string[] }>;
} {
  const tasksDir = join(dataDir, 'tasks');
  for (const entry of existsSync(tasksDir) ? readdirSync(tasksDir, { withFileTypes: true }) : []) {
    if (!entry.isDirectory()) continue;
    const p = join(tasksDir, entry.name, `${sid}.json`);
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  }
  throw new Error(`session file not found for ${sid}`);
}

describe('SessionStore 用户消息身份（clientMessageId）', () => {
  it('传入时落盘并可跨实例重载（模拟刷新/重启）', () => {
    const sid = 'sess-identity-1';
    const store = makeStore();
    const session = store.getOrCreate(sid);
    store.addUserMessage(session, '你好，帮我看看这段代码', undefined, 'msg_client_123');
    store.persistSession(session);

    const onDisk = readPersisted(sid);
    const first = onDisk.messages[0];
    expect(first.role).toBe('user');
    expect(first.clientMessageId).toBe('msg_client_123');

    // 新实例从同一 dataDir 重新加载（等同进程重启/刷新后重新读取）
    const reloaded = makeStore().get(sid);
    expect(reloaded?.messages[0]?.clientMessageId).toBe('msg_client_123');
  });

  it('未传入时不写该字段（旧数据保持紧凑）', () => {
    const sid = 'sess-identity-2';
    const store = makeStore();
    const session = store.getOrCreate(sid);
    store.addUserMessage(session, '没有身份的消息');
    store.persistSession(session);

    const first = readPersisted(sid).messages[0];
    expect(first.role).toBe('user');
    expect('clientMessageId' in first).toBe(false);
  });

  it('与附件结构化字段共存往返', () => {
    const sid = 'sess-identity-3';
    const store = makeStore();
    const session = store.getOrCreate(sid);
    store.addUserMessage(session, '带附件与身份', ['D:\\LocalSend\\a.txt'], 'msg_client_999');
    store.persistSession(session);

    const reloaded = makeStore().get(sid);
    const m = reloaded?.messages[0];
    expect(m?.clientMessageId).toBe('msg_client_999');
    expect(m?.attachments).toEqual(['D:\\LocalSend\\a.txt']);
  });

  it('assistant / tool 消息不会被写入该字段', () => {
    const sid = 'sess-identity-4';
    const store = makeStore();
    const session = store.getOrCreate(sid);
    store.addUserMessage(session, '提问', undefined, 'msg_client_a');
    store.addAssistantMessage(session, '回答');
    store.addToolMessage(session, 'call_1', '工具结果', 'read');
    store.persistSession(session);

    const msgs = readPersisted(sid).messages;
    expect(msgs[0].clientMessageId).toBe('msg_client_a');
    expect('clientMessageId' in msgs[1]).toBe(false);
    expect('clientMessageId' in msgs[2]).toBe(false);
  });
});