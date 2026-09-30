// src/modules/agent/session-attachments.test.ts
// 附件结构化字段（user 消息 attachments）持久化测试：
//   1. addUserMessage 带 attachments → persistSession 立即落盘，JSON 中字段完整（含中文/盘符/反斜杠）
//   2. 新 SessionStore 实例从同一 dataDir 重新加载 → 字段往返不丢（模拟进程重启）
//   3. 无附件时该字段不写入（保持旧数据紧凑）

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
  dataDir = mkdtempSync(join(tmpdir(), 'moss-attachment-test-'));
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

/**
 * 定位落盘文件：tasks/<dir>/<sid>.json。
 * 按磁盘实际位置扫描（不假设目录名），与 SessionStore.sessionFilePath 的解析顺序解耦。
 */
function findSessionFile(sid: string): string {
  const tasksDir = join(dataDir, 'tasks');
  if (existsSync(tasksDir)) {
    for (const entry of readdirSync(tasksDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const p = join(tasksDir, entry.name, `${sid}.json`);
      if (existsSync(p)) return p;
    }
  }
  throw new Error(`session file not found for ${sid} under ${tasksDir}`);
}

/** 直接读磁盘 JSON（不经 SessionStore，排除内存缓存掩盖问题） */
function readPersisted(sid: string): {
  messages: Array<{ role: string; content: string; attachments?: string[] }>;
} {
  return JSON.parse(readFileSync(findSessionFile(sid), 'utf8'));
}

describe('SessionStore 附件结构化字段', () => {
  it('带 attachments 的用户消息落盘后字段完整', () => {
    const store = makeStore();
    const session = store.getOrCreate('s1');
    const paths = [
      'D:\\LocalSend\\Image_1787821758258_739.jpg',
      'D:\\LocalSend\\test\\燃烧我的Tokens.mp4',
      '/home/u/notes/我不是Token神.mp3',
    ];

    store.addUserMessage(session, '看这几个文件', paths);
    store.persistSession(session);

    const persisted = readPersisted('s1');
    expect(persisted.messages).toHaveLength(1);
    expect(persisted.messages[0].role).toBe('user');
    expect(persisted.messages[0].attachments).toEqual(paths);
  });

  it('重新加载（模拟重启）后 attachments 往返一致', () => {
    const paths = ['D:\\a\\b.png', 'D:\\a\\c.mp4'];
    const first = makeStore();
    const session = first.getOrCreate('s2');
    first.addUserMessage(session, '附件：\n- D:\\a\\b.png\n- D:\\a\\c.mp4', paths);
    first.persistSession(session);
    first.dispose();

    // 全新实例 + 空内存，强制走磁盘加载
    const second = makeStore();
    const reloaded = second.get('s2');
    expect(reloaded).not.toBeNull();
    expect(reloaded?.messages[0].attachments).toEqual(paths);
    expect(reloaded?.messages[0].content).toBe('附件：\n- D:\\a\\b.png\n- D:\\a\\c.mp4');
  });

  it('无附件时不写入 attachments 字段（旧数据紧凑）', () => {
    const store = makeStore();
    const session = store.getOrCreate('s3');
    store.addUserMessage(session, '只有正文');
    store.persistSession(session);

    const persisted = readPersisted('s3');
    expect(persisted.messages[0].content).toBe('只有正文');
    expect('attachments' in persisted.messages[0]).toBe(false);
  });

  it('空数组等同于无附件（不写入字段）', () => {
    const store = makeStore();
    const session = store.getOrCreate('s4');
    store.addUserMessage(session, '正文', []);
    store.persistSession(session);

    const persisted = readPersisted('s4');
    expect('attachments' in persisted.messages[0]).toBe(false);
  });
});