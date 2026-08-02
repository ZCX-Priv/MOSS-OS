// frontend/src/components/MessageInput.tsx
// 消息输入组件

import { useRef, useEffect } from 'react';
import { useStore } from '../store';
import { useChat } from '../hooks/useChat';

export function MessageInput() {
  const { input, setInput, isGenerating, selectedModel, selectedProvider, apiConfig, workingDirectory, wsStatus } = useStore();
  const { sendMessage, abort } = useChat();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 自适应高度
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    }
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // 收集所有可选 model
  const allModels: Array<{ provider: string; model: string }> = [];
  if (apiConfig) {
    for (const [name, p] of Object.entries(apiConfig.providers)) {
      for (const m of p.models) {
        allModels.push({ provider: name, model: m });
      }
    }
  }

  const handleModelChange = (value: string) => {
    const [provider, model] = value.split('||');
    useStore.getState().setSelectedProvider(provider);
    useStore.getState().setSelectedModel(model);
  };

  const currentValue = selectedProvider && selectedModel ? `${selectedProvider}||${selectedModel}` : '';

  const wsDisconnected = wsStatus !== 'open';
  const wsHint =
    wsStatus === 'connecting' ? '正在连接服务器…'
    : wsStatus === 'closed' ? '未连接服务器（消息将排队，连接后发送）'
    : wsStatus === 'error' ? '连接错误，正在重连…'
    : '';

  return (
    <div className="message-input">
      {wsDisconnected && wsHint && (
        <div className="ws-status-bar" role="status" aria-live="polite">
          ⚠ {wsHint}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
        disabled={isGenerating}
      />
      <div className="input-actions">
        <div className="input-meta">
          <select
            value={currentValue}
            onChange={(e) => handleModelChange(e.target.value)}
            title="选择模型"
          >
            {allModels.length === 0 && <option value="">(未配置模型)</option>}
            {allModels.map(({ provider, model }) => (
              <option key={`${provider}||${model}`} value={`${provider}||${model}`}>
                {provider} / {model}
              </option>
            ))}
          </select>
          <span title="工作目录">📁 {workingDirectory || '(默认)'}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {isGenerating ? (
            <button onClick={abort}>停止</button>
          ) : (
            <button
              className="primary"
              onClick={() => sendMessage()}
              disabled={!input.trim()}
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
