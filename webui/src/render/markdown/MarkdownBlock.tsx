// render/markdown/MarkdownBlock.tsx
// 单块组件：React.memo 浅比较（raw/closed 不变即跳过重渲）——
// append-only 流保证闭块 raw 永不变，实现"闭块冻结、只重渲活跃块"。

import { memo } from 'react';
import { renderBlockToReact } from '../core/token-to-react';

export interface MarkdownBlockProps {
  raw: string;
  closed: boolean;
}

function MarkdownBlockImpl({ raw, closed }: MarkdownBlockProps) {
  return <>{renderBlockToReact(raw, closed)}</>;
}

/** memo 冻结：raw 与 closed 均不变时整块（含 Shiki/KaTeX/Mermaid 子树）零重渲 */
export const MarkdownBlock = memo(MarkdownBlockImpl);
