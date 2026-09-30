// render/core/PreviewErrorBoundary.tsx
// 预览级错误边界：单个渲染器抛错时只替换该区域为「回退链下一级」，
// 而不是触发 App 顶层 ErrorBoundary（那是整页错误卡片）。
// 供 FilePreviewPane 的每一级回退包裹使用。

import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface PreviewErrorBoundaryProps {
  children: ReactNode;
  /** 出错时渲染的兜底内容（通常为回退链的下一级渲染器） */
  fallback: ReactNode;
  /** 出错回调（日志/诊断用） */
  onError?: (error: Error) => void;
  /** 重置键：变化时清除错误状态并重新渲染（如切换文件 path） */
  resetKey?: string;
}

interface PreviewErrorBoundaryState {
  error: Error | null;
}

export class PreviewErrorBoundary extends Component<PreviewErrorBoundaryProps, PreviewErrorBoundaryState> {
  state: PreviewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PreviewErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('File preview render error caught by PreviewErrorBoundary:', error, info.componentStack);
    this.props.onError?.(error);
  }

  componentDidUpdate(prevProps: PreviewErrorBoundaryProps): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    return this.state.error !== null ? this.props.fallback : this.props.children;
  }
}