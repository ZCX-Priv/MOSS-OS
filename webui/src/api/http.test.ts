// webui/src/api/http.test.ts
// adaptAgentMessages 单测：id 优先级（clientMessageId / messageId / h<index> / 位置 id）
// + 重复 id 去重防御（旧版本按 `<sessionId>#<turn>` 落盘产生跨 run 重复 messageId 的脏数据）
// + tool 结果就近合并与孤儿回填不受去重影响。
// 运行：npx bun test webui/src/api/http.test.ts（或根目录 npm test）

import { describe, it, expect } from 'bun:test';
import { adaptAgentMessages } from './adapt-messages';

describe('adaptAgentMessages id 优先级', () => {
  it('user 消息：clientMessageId 优先', () => {
    const out = adaptAgentMessages([
      { role: 'user', content: '问题', clientMessageId: 'cmid_1', index: 0 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('cmid_1');
    expect(out[0].clientMessageId).toBe('cmid_1');
  });

  it('assistant 消息：messageId 优先并写入 serverMessageId', () => {
    const out = adaptAgentMessages([
      { role: 'assistant', content: '回答', messageId: 's#5', index: 1 },
    ]);
    expect(out[0].id).toBe('s#5');
    expect(out[0].serverMessageId).toBe('s#5');
  });

  it('无 messageId 的旧 assistant 消息：回退 h<index>', () => {
    const out = adaptAgentMessages([{ role: 'assistant', content: '旧回答', index: 3 }]);
    expect(out[0].id).toBe('h3');
    expect(out[0].serverMessageId).toBeUndefined();
  });

  it('全量旧路径（无 index）：位置 id', () => {
    const out = adaptAgentMessages([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
    expect(out[0].id).toBe('0-user');
    expect(out[1].id).toBe('1-assistant');
  });
});

describe('adaptAgentMessages 重复 id 去重防御', () => {
  it('两条同 messageId 的 assistant（旧脏数据）→ 后者回退 h<index>，无重复 key', () => {
    const out = adaptAgentMessages([
      { role: 'user', content: 'q1', index: 0 },
      { role: 'assistant', content: '第一轮回答', messageId: 'sess#1', index: 1 },
      { role: 'user', content: 'q2', index: 2 },
      { role: 'assistant', content: '第二轮回答', messageId: 'sess#1', index: 3 },
    ]);
    expect(out).toHaveLength(4);
    expect(out[1].id).toBe('sess#1');
    // 后者与前者 id 冲突 → 回退绝对下标 id
    expect(out[3].id).toBe('h3');
    // 全列表无重复 id
    const ids = out.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('clientMessageId 重复（乐观副本与历史重复等异常）→ 后者回退且不抛错', () => {
    const out = adaptAgentMessages([
      { role: 'user', content: 'q', clientMessageId: 'cmid_x', index: 0 },
      { role: 'user', content: 'q', clientMessageId: 'cmid_x', index: 1 },
    ]);
    expect(out[0].id).toBe('cmid_x');
    expect(out[1].id).toBe('h1');
  });

  it('全量路径下 id 完全相同（无 index 极端脏数据）→ 位置后缀兜底', () => {
    const out = adaptAgentMessages([
      { role: 'assistant', content: 'a', messageId: 'sess#1' },
      { role: 'assistant', content: 'b', messageId: 'sess#1' },
    ]);
    expect(out[0].id).toBe('sess#1');
    expect(out[1].id).not.toBe(out[0].id);
  });
});

describe('adaptAgentMessages 工具结果合并', () => {
  it('role=tool 就近合并到前一条 assistant 的 toolResults', () => {
    const out = adaptAgentMessages([
      { role: 'user', content: 'q', index: 0 },
      {
        role: 'assistant',
        content: '',
        messageId: 's#1',
        index: 1,
        toolCalls: [{ id: 'call_1', name: 'read', arguments: '{}' }],
      },
      { role: 'tool', content: '文件内容', toolCallId: 'call_1', index: 2 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].toolResults).toHaveLength(1);
    expect(out[1].toolResults?.[0].toolCallId).toBe('call_1');
  });

  it('孤儿结果（前一条不是 assistant）按 toolCallId 回填到真正发起的 assistant，不受去重影响', () => {
    const out = adaptAgentMessages([
      { role: 'user', content: 'q', index: 0 },
      {
        role: 'assistant',
        content: '发起调用',
        messageId: 's#1',
        index: 1,
        toolCalls: [{ id: 'call_9', name: 'subagent', arguments: '{}' }],
      },
      { role: 'user', content: '中间插话', index: 2 },
      { role: 'tool', content: '迟到的结果', toolCallId: 'call_9', index: 3 },
    ]);
    const owner = out.find((m) => m.id === 's#1');
    expect(owner?.toolResults).toHaveLength(1);
    expect(owner?.toolResults?.[0].toolCallId).toBe('call_9');
  });
});
