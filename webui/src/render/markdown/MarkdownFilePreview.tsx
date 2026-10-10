// render/markdown/MarkdownFilePreview.tsx
// Markdown 文件预览：顶部「预览 / 代码」胶囊切换。
// - 预览：MarkdownRenderer（streaming=false，冻结全量渲染）
// - 代码：CodeFileViewer（Shiki 高亮 + 行号）
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useState } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { CodeFileViewer } from '../code/CodeFileViewer';
import { PreviewModeToggle, type PreviewMode } from '../core/PreviewModeToggle';

export interface MarkdownFilePreviewProps {
  text: string;
  path: string;
}

export function MarkdownFilePreview({ text, path }: MarkdownFilePreviewProps) {
  const [mode, setMode] = useState<PreviewMode>('preview');

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center">
        <PreviewModeToggle mode={mode} onChange={setMode} />
      </div>
      {mode === 'code' ? (
        <div className="min-h-0 flex-1">
          <CodeFileViewer text={text} path={path} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border bg-background p-3">
          <MarkdownRenderer text={text} streaming={false} />
        </div>
      )}
    </div>
  );
}
