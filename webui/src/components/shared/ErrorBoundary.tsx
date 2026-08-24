import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));
}

/**
 * 顶层错误边界：任何组件渲染异常在此兜底为可见的错误卡片，而非整树白屏。
 * 不依赖 i18n/Provider（错误场景下这些可能正是故障源）——按 <html lang> 双语直出。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI render error caught by ErrorBoundary:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const lang = document.documentElement.lang || 'zh';
    const isZh = lang.startsWith('zh');
    const summary = `${error.name}: ${error.message}`;
    const detail = error.stack ?? '';

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#09090b',
          color: '#e4e4e7',
          fontFamily: 'system-ui, sans-serif',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: 560, width: '100%' }}>
          <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>
            {isZh ? '界面出现错误' : 'Something went wrong'}
          </h1>
          <p style={{ fontSize: 13, color: '#a1a1aa', margin: '0 0 16px' }}>
            {isZh
              ? '渲染过程中发生异常。你可以重新加载页面；若反复出现请查看控制台或日志。'
              : 'A rendering error occurred. You can reload the page; if it persists, check the console or logs.'}
          </p>
          <p
            style={{
              fontSize: 12,
              fontFamily: 'ui-monospace, monospace',
              color: '#f87171',
              margin: '0 0 16px',
              wordBreak: 'break-all',
            }}
          >
            {summary}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 20px',
              borderRadius: 8,
              border: '1px solid #3f3f46',
              background: '#18181b',
              color: '#e4e4e7',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {isZh ? '重新加载' : 'Reload'}
          </button>
          {detail && (
            <details style={{ marginTop: 16 }}>
              <summary style={{ fontSize: 12, color: '#a1a1aa', cursor: 'pointer' }}>
                {isZh ? '错误详情' : 'Error details'}
              </summary>
              <pre
                style={{
                  fontSize: 11,
                  color: '#a1a1aa',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 240,
                  overflow: 'auto',
                }}
              >
                {detail}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}

// 供非 React 场景复用（保持 tree-shaking 友好，未使用时可被剔除）
export { escapeHtml };
