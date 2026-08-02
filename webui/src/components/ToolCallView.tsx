// frontend/src/components/ToolCallView.tsx
// 工具调用展示：可折叠，显示工具名、参数、结果

import { useState } from 'react';
import type { ToolCall, ToolResult } from '../types';

interface Props {
  toolCall: ToolCall;
  result?: ToolResult;
}

export function ToolCallView({ toolCall, result }: Props) {
  const [expanded, setExpanded] = useState(false);

  let argsDisplay = '';
  try {
    argsDisplay = JSON.stringify(JSON.parse(toolCall.arguments), null, 2);
  } catch {
    argsDisplay = toolCall.arguments;
  }

  const resultText = result?.content
    .map((c) => (c.type === 'text' ? c.text : `[image: ${c.source.mimeType}]`))
    .join('\n');

  return (
    <div className="tool-call">
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-call-name">{toolCall.name}</span>
        <span className="tool-call-status">
          {result ? (result.isError ? 'error' : 'done') : 'running...'}
        </span>
        <span style={{ marginLeft: '8px' }}>{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <div className="tool-call-body">
          <div style={{ color: 'var(--text-muted)', marginBottom: '4px' }}>Arguments:</div>
          <pre style={{ margin: '0 0 8px' }}>{argsDisplay || '(none)'}</pre>
          {result && (
            <>
              <div style={{ color: 'var(--text-muted)', marginBottom: '4px' }}>Result:</div>
              <pre className={result.isError ? 'tool-call-error' : ''} style={{ margin: 0 }}>
                {resultText || '(empty)'}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
