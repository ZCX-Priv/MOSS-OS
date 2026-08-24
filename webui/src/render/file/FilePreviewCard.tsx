// render/file/FilePreviewCard.tsx
// 内联文件预览卡片：图标 + 文件名 + 类型徽章（图片直接缩略）；点击打开全屏预览弹层。
// filePreviewEnabled=false 或未知类型时回退普通 code 文本（零开销）。

import { useEffect, useState } from 'react';
import { Box, File, FileImage, FileSpreadsheet, FileText, Presentation } from 'lucide-react';
import { detectFileKind, fileNameOf } from './detector';
import { fetchFileObjectUrl, mimeOfPath } from './fetcher';
import { FilePreviewDialog } from './FilePreviewDialog';
import { useRenderSettings } from '../core/settings';
import type { RendererKind } from '../core/types';

function iconOf(kind: RendererKind) {
  switch (kind) {
    case 'office-docx':
      return FileText;
    case 'office-xlsx':
      return FileSpreadsheet;
    case 'office-pptx':
      return Presentation;
    case 'pdf':
      return FileText;
    case 'three-d':
      return Box;
    case 'image':
      return FileImage;
    default:
      return File;
  }
}

const KIND_LABEL: Record<RendererKind, string> = {
  'office-docx': 'DOCX',
  'office-xlsx': 'XLSX',
  'office-pptx': 'PPTX',
  pdf: 'PDF',
  'three-d': '3D',
  image: 'IMG',
  text: 'TXT',
  unknown: 'FILE',
};

export interface FilePreviewCardProps {
  path: string;
}

export function FilePreviewCard({ path }: FilePreviewCardProps) {
  const settings = useRenderSettings();
  const kind = detectFileKind(path);
  const name = fileNameOf(path);
  const [open, setOpen] = useState(false);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  const supported = kind !== 'unknown' && kind !== 'text';

  // 图片：卡片内直接加载缩略
  useEffect(() => {
    if (kind !== 'image') return;
    let cancelled = false;
    void fetchFileObjectUrl(path, mimeOfPath(path))
      .then((url) => {
        if (!cancelled) setThumbUrl(url);
      })
      .catch(() => {
        // 缩略加载失败：保持图标形态
      });
    return () => {
      cancelled = true;
    };
  }, [path, kind]);

  // 开关关闭 / 不支持的类型：普通 code 文本
  if (!settings.filePreviewEnabled || !supported) {
    return <code className="md-code-inline break-all">{path}</code>;
  }

  const Icon = iconOf(kind);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="my-1 inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1 text-left transition-colors hover:bg-muted"
        title={path}
      >
        {thumbUrl !== null ? (
          <img src={thumbUrl} alt={name} className="h-8 w-8 rounded object-cover" loading="lazy" />
        ) : (
          <Icon className="size-4 shrink-0 text-primary-strong" />
        )}
        <span className="truncate font-mono text-xs text-foreground">{name}</span>
        <span className="shrink-0 rounded bg-primary-strong/10 px-1 py-0.5 font-mono text-[10px] text-primary-strong">
          {KIND_LABEL[kind]}
        </span>
      </button>
      <FilePreviewDialog path={path} open={open} onOpenChange={setOpen} />
    </>
  );
}
