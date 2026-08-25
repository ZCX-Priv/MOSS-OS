// src/modules/context/compiler/view-builder.test.ts
// 发送视图构建测试：ephemeral 尾部消息（L2 记忆召回）、锚定消息恒保留、
// breakdown 的 rules/memory 构成统计。

import { describe, test, expect } from 'vitest';
import { buildRequestView, ACTIVE_RULES_MSG_NAME, MEMORY_L1_MSG_NAME, MEMORY_RECALL_MSG_NAME } from './view-builder';
import type { ContextMessage, ContextSessionLike } from '../types';
import { DEFAULT_TOOL_PRUNING_CONFIG } from '../types';

function mkSession(messages: ContextMessage[]): ContextSessionLike {
  return {
    id: 'test-session',
    messages,
    updatedAt: new Date().toISOString(),
  };
}

describe('view-builder（ephemeral + breakdown 扩展）', () => {
  const baseMessages: ContextMessage[] = [
    { role: 'user', name: 'env-context', content: '[环境上下文]' },
    { role: 'user', content: '用户问题：如何优化缓存？' },
    { role: 'assistant', content: '我来分析', toolCalls: [{ id: 'tc1', name: 'read', arguments: '{"path":"a.ts"}' }] },
    { role: 'tool', toolCallId: 'tc1', name: 'read', content: '文件内容...' },
  ];

  test('ephemeral 消息追加在消息流末尾（不进 session）', () => {
    const session = mkSession(baseMessages);
    const ephemeral: ContextMessage[] = [
      { role: 'user', name: MEMORY_RECALL_MSG_NAME, content: '[记忆 | 相关记忆]\n- xxx' },
    ];
    const view = buildRequestView(session, 'SYSTEM', {
      toolPruning: DEFAULT_TOOL_PRUNING_CONFIG,
      ephemeralMessages: ephemeral,
    });
    // 最后一条对话消息是 ephemeral
    const last = view.messages[view.messages.length - 1];
    expect(last.name).toBe(MEMORY_RECALL_MSG_NAME);
    expect(last.content).toContain('相关记忆');
    // session 未被修改
    expect(session.messages).toHaveLength(4);
  });

  test('breakdown：rules/memory 段独立统计', () => {
    const session = mkSession([
      ...baseMessages,
      { role: 'user', name: ACTIVE_RULES_MSG_NAME, content: '[项目规则 | TS 规范] 内容内容内容' },
      { role: 'user', name: MEMORY_L1_MSG_NAME, content: '[记忆 | 关键事实] 事实事实' },
    ]);
    const view = buildRequestView(session, 'SYSTEM', {
      toolPruning: DEFAULT_TOOL_PRUNING_CONFIG,
      ephemeralMessages: [
        { role: 'user', name: MEMORY_RECALL_MSG_NAME, content: '[记忆 | 相关记忆] 召回召回' },
      ],
    });
    expect(view.breakdown.rules).toBeGreaterThan(0);
    expect(view.breakdown.memory).toBeGreaterThan(0);
    expect(view.breakdown.total).toBe(
      view.breakdown.system + view.breakdown.env + view.breakdown.summary +
      view.breakdown.history + view.breakdown.rules + view.breakdown.memory,
    );
  });

  test('无 ephemeral 时 breakdown.rules/memory = 0（零注入零开销）', () => {
    const session = mkSession(baseMessages);
    const view = buildRequestView(session, 'SYSTEM', {
      toolPruning: DEFAULT_TOOL_PRUNING_CONFIG,
    });
    expect(view.breakdown.rules).toBe(0);
    expect(view.breakdown.memory).toBe(0);
  });
});
