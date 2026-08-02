// frontend/src/components/MessageList.tsx
// 消息列表展示

import { useStore } from '../store';
import type { ChatMessage } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ToolCallView } from './ToolCallView';

export function MessageList() {
  const { activeSessionId, messagesBySession } = useStore();
  const messages = activeSessionId ? messagesBySession[activeSessionId] ?? [] : [];

  if (messages.length === 0) {
    return (
      <div className="message-list" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>MOSS-OS</h2>
          <p>输入消息开始对话，或选择左侧会话查看历史</p>
        </div>
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map((msg) => (
        <MessageItem key={msg.id} message={msg} />
      ))}
    </div>
  );
}

function MessageItem({ message }: { message: ChatMessage }) {
  const roleLabel = {
    system: 'SYSTEM',
    user: 'YOU',
    assistant: 'MOSS',
    tool: 'TOOL',
  }[message.role];

  return (
    <div className={`message ${message.role}`}>
      <div className="message-role">
        {roleLabel}
        {message.streaming && <span style={{ marginLeft: '6px', color: 'var(--warning)' }}>● streaming</span>}
      </div>
      <div className="message-content">
        {message.thinking && (
          <details className="message-thinking">
            <summary>Thinking...</summary>
            <div className="message-thinking-content">{message.thinking}</div>
          </details>
        )}
        {message.content && <MarkdownRenderer content={message.content} />}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div style={{ marginTop: '8px' }}>
            {message.toolCalls.map((tc, idx) => (
              <ToolCallView
                key={tc.id}
                toolCall={tc}
                result={message.toolResults?.find((r) => r.toolCallId === tc.id)?.result}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
