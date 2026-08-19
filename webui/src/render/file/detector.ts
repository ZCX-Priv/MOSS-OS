// render/file/detector.ts
// 文件类型检测：扩展名 → RendererKind（预览分发）。

import type { RendererKind } from '../core/types';

const KIND_BY_EXT: Record<string, RendererKind> = {
  docx: 'office-docx',
  xlsx: 'office-xlsx',
  pptx: 'office-pptx',
  pdf: 'pdf',
  glb: 'three-d',
  gltf: 'three-d',
  obj: 'three-d',
  stl: 'three-d',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  txt: 'text',
  md: 'text',
};

export function fileExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function detectFileKind(path: string): RendererKind {
  return KIND_BY_EXT[fileExtension(path)] ?? 'unknown';
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
