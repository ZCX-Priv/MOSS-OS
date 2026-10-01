// src/modules/agent/live-draft.test.ts
// 流式草稿存储单测（刷新后恢复半截回复 + offset 续接的数据基础）：
//   1. begin 立即落盘（保证 turn 刚开始就刷新也能拿到正确 messageId）
//   2. 内存态为权威：appendContent 后 get 立刻可见（无需等节流写盘）
//   3. 写盘节流：短时间多次追加只写一次；长度未变化不重复写
//   4. 工具状态变更强制写盘（刷新后卡片状态保真）
//   5. clear 删除内存 + 磁盘文件
//   6. 新实例从同一 dataDir 读到残留草稿并标记 stale（进程重启场景）

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger, Environment } from '../../core/types';
import { LiveDraftStore } from './live-draft';

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
  dataDir = mkdtempSync(join(tmpdir(), 'moss-livedraft-test-'));
});

afterEach(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows 偶发句柄延迟释放
  }
});

function makeStore(): LiveDraftStore {
  return new LiveDraftStore({ dataDir } as Environment, logger);
}

/** 直接读磁盘 JSON（不经内存缓存，排除缓存掩盖问题） */
function readDraftFile(sid: string): Record<string, unknown> | null {
  const p = join(dataDir, 'live', `${sid}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

describe('LiveDraftStore', () => {
  it('begin 立即落盘，且返回的 messageId / 长度正确', () => {
    const store = makeStore();
    const d = store.begin('sess1', 'sess1#2', 'run1', 2);
    expect(d.messageId).toBe('sess1#2');
    expect(d.contentLength).toBe(0);

    const onDisk = readDraftFile('sess1');
    expect(onDisk).not.toBeNull();
    expect(onDisk!.messageId).toBe('sess1#2');
    expect(onDisk!.runId).toBe('run1');
    expect(onDisk!.turnIndex).toBe(2);
  });

  it('内存态权威：追加后立即读回（不必等节流写盘）', () => {
    const store = makeStore();
    store.begin('sess1', 'sess1#1');
    store.appendContent('sess1', '你好');
    store.appendThinking('sess1', '思考');

    const d = store.get('sess1')!;
    expect(d.content).toBe('你好');
    expect(d.contentLength).toBe(2);
    expect(d.thinking).toBe('思考');
    expect(d.thinkingLength).toBe(2);
  });

  it('写盘节流：短时间多次追加只写一次，且长度未变化时不重复写', () => {
    const store = makeStore();
    store.begin('sess1', 'sess1#1');
    // begin 已写一次（force）；记录此刻内容
    expect(readDraftFile('sess1')!.content).toBe('');

    store.appendContent('sess1', 'a');
    store.appendContent('sess1', 'b');
    store.appendContent('sess1', 'c');
    // 500ms 节流窗口内：磁盘仍为 begin 时的空内容（内存已是 abc）
    expect(readDraftFile('sess1')!.content).toBe('');
    expect(store.get('sess1')!.content).toBe('abc');
  });

  it('工具调用状态变更强制写盘（刷新后卡片状态保真）', () => {
    const store = makeStore();
    store.begin('sess1', 'sess1#1');
    store.upsertToolCall('sess1', { id: 'tc1', name: 'read', arguments: '', status: 'generating' });
    expect((readDraftFile('sess1')!.toolCalls as unknown[]).length).toBe(1);

    store.setToolCallStatus('sess1', 'tc1', 'executing');
    const d = readDraftFile('sess1')!;
    expect((d.toolCalls as Array<{ status: string }>)[0].status).toBe('executing');
  });

  it('工具参数分片按 toolCallId 累加', () => {
    const store = makeStore();
    store.begin('sess1', 'sess1#1');
    store.upsertToolCall('sess1', { id: 'tc1', name: 'read', arguments: '', status: 'generating' });
    store.appendToolArguments('sess1', 'tc1', '{"pa');
    store.appendToolArguments('sess1', 'tc1', 'th":"a"}');
    expect(store.get('sess1')!.toolCalls[0].arguments).toBe('{"path":"a"}');
  });

  it('clear 同时清除内存与磁盘文件', () => {
    const store = makeStore();
    store.begin('sess1', 'sess1#1');
    expect(readDraftFile('sess1')).not.toBeNull();
    store.clear('sess1');
    expect(store.get('sess1')).toBeNull();
    expect(readDraftFile('sess1')).toBeNull();
  });

  it('进程重启：新实例读到残留草稿并标记 stale', () => {
    const first = makeStore();
    first.begin('sess1', 'sess1#1', 'run1');
    first.appendContent('sess1', '半截回复');
    // 文本追加受 500ms 节流保护；用一次工具状态变更（强制写盘）把当前完整草稿刷到磁盘，
    // 模拟「崩溃前刚发生过一次强制落盘」的真实场景
    first.upsertToolCall('sess1', { id: 'tc1', name: 'read', arguments: '', status: 'generating' });

    // 模拟进程重启：新实例（内存为空）→ snapshot 标记 stale（对外语义）
    const second = makeStore();
    const restored = second.snapshot('sess1');
    expect(restored).not.toBeNull();
    expect(restored!.content).toBe('半截回复');
    expect(restored!.stale).toBe(true);
    // get 为纯内存读（内部热路径用）：不附加标记
    expect(second.get('sess1')!.content).toBe('半截回复');

    // 新一轮运行开始后 stale 标记消失
    second.begin('sess1', 'sess1#2', 'run2');
    expect(second.snapshot('sess1')!.stale).toBeUndefined();
    expect(second.snapshot('sess1')!.content).toBe('');
  });

  it('snapshot 对内存态不附加 stale（活跃 run 的正常读路径）', () => {
    const store = makeStore();
    store.begin('sess1', 'sess1#1');
    expect(store.snapshot('sess1')!.stale).toBeUndefined();
    expect(store.snapshot('missing')).toBeNull();
  });
});