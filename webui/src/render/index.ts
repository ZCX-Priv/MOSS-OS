// render/index.ts
// 渲染模块唯一公共出口 —— 外部（消息区/设置页/其他页面）只准从这里 import。
// 重依赖（shiki/mermaid/mathjax/pdfjs/three/docx/exceljs）全部在各子模块内部 dynamic import，
// 引用本模块本身的首屏成本仅 markdown-it + katex css。

// Markdown 渲染
export { MarkdownRenderer } from './markdown/MarkdownRenderer';
export type { MarkdownRendererProps } from './markdown/MarkdownRenderer';

// 文件预览
export { FilePreviewCard } from './file/FilePreviewCard';
export { FilePreviewDialog } from './file/FilePreviewDialog';
export { detectFileKind, fileNameOf, fileExtension } from './file/detector';

// 设置
export { useRenderSettings } from './core/settings';
export { DEFAULT_RENDER_SETTINGS, isValidRenderSettings } from './core/types';
export type { RenderSettings, RenderBlock, RendererKind } from './core/types';

// 样式（katex 字体 + 排版）
import 'katex/dist/katex.min.css';
import './styles/markdown.css';
