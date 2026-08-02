// webui/src/components/AskPrompt.tsx
// 工具发起的提问面板：当 ask 工具调用阻塞等待回复时，渲染输入框供用户作答。

import { useState } from 'react';
import { useStore } from '../store';
import { useChat } from '../hooks/useChat';

export function AskPrompt() {
  const pendingAsks = useStore((s) => s.pendingAsks);
  const { replyAsk } = useChat();
  // 每个待答提问对应一个本地输入框
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (pendingAsks.length === 0) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, toolCallId: string) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(toolCallId);
    }
  };

  const submit = (toolCallId: string) => {
    const answer = (drafts[toolCallId] ?? '').trim();
    if (!answer) return;
    replyAsk(toolCallId, answer);
    setDrafts((d) => {
      const next = { ...d };
      delete next[toolCallId];
      return next;
    });
  };

  return (
    <div className="ask-prompt-container">
      {pendingAsks.map((ask) => (
        <div key={ask.toolCallId} className="ask-prompt-card">
          <div className="ask-prompt-question">
            <span className="ask-prompt-icon" aria-hidden>❓</span>
            <span>{ask.question}</span>
          </div>
          <textarea
            className="ask-prompt-input"
            value={drafts[ask.toolCallId] ?? ''}
            onChange={(e) =>
              setDrafts((d) => ({ ...d, [ask.toolCallId]: e.target.value }))
            }
            onKeyDown={(e) => handleKeyDown(e, ask.toolCallId)}
            placeholder="输入回复... (Enter 发送，Shift+Enter 换行)"
            autoFocus
            rows={2}
          />
          <div className="ask-prompt-actions">
            <button
              className="primary"
              onClick={() => submit(ask.toolCallId)}
              disabled={!(drafts[ask.toolCallId] ?? '').trim()}
            >
              回复
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
