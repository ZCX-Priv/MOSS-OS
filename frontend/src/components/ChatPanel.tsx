// frontend/src/components/ChatPanel.tsx
// 聊天主面板

import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';

export function ChatPanel() {
  return (
    <div className="chat-panel">
      <MessageList />
      <MessageInput />
    </div>
  );
}
