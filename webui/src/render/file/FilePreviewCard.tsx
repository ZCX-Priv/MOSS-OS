// render/file/FilePreviewCard.tsx
// 内联文件预览卡片：图标 + 文件名 + 类型徽章（图片直接缩略）；点击打开预览。
// 打开方式由 useOpenFilePreview 统一决策：桌面端 → 右侧边栏标签；移动端 → 弹层。
// filePreviewEnabled=false 或未知类型时回退普通 code 文本（零开销）。

import { useEffect, useState } from 'react';
import {
  Archive,
  BookOpen,
  Box,
  Calendar,
  Captions,
  Code,
  Contact,
  Database,
  DraftingCompass,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  MapPin,
  Music,
  Palette,
  Presentation,
  ShieldCheck,
  Sigma,
  Table,
  Type,
  Video,
  Zap,
} from 'lucide-react';
import { detectFileKind, fileNameOf } from './detector';
import { fetchFileObjectUrl, getCachedObjectUrl, mimeOfPath } from './fetcher';
import { useRenderSettings } from '../core/settings';
import { useStore } from '../../store';
import { useOpenFilePreview } from '../../hooks/useOpenFilePreview';
import type { RendererKind } from '../core/types';

function iconOf(kind: RendererKind) {
  switch (kind) {
    case 'office-docx':
      return FileText;
    case 'office-xlsx':
      return FileSpreadsheet;
    case 'office-pptx':
      return Presentation;
    case 'office-odf':
    case 'office-legacy':
      return FileText;
    case 'pdf':
      return FileText;
    case 'ebook':
      return BookOpen;
    case 'video':
      return Video;
    case 'audio':
      return Music;
    case 'html':
    case 'code':
    case 'markdown':
      return Code;
    case 'data':
      return Table;
    case 'font':
      return Type;
    case 'archive':
      return Archive;
    case 'three-d':
      return Box;
    case 'image':
      return FileImage;
    case 'subtitle':
      return Captions;
    case 'calendar':
      return Calendar;
    case 'contact':
      return Contact;
    case 'geo':
      return MapPin;
    case 'certificate':
      return ShieldCheck;
    case 'colorprofile':
      return Palette;
    case 'cad':
      return DraftingCompass;
    case 'sqlite':
      return Database;
    case 'flash':
      return Zap;
    case 'latex':
      return Sigma;
    default:
      return File;
  }
}

const KIND_LABEL: Record<RendererKind, string> = {
  'office-docx': 'DOCX',
  'office-xlsx': 'XLSX',
  'office-pptx': 'PPTX',
  'office-odf': 'ODF',
  'office-legacy': 'OFFICE',
  pdf: 'PDF',
  ebook: 'BOOK',
  video: 'VIDEO',
  audio: 'AUDIO',
  html: 'HTML',
  markdown: 'MD',
  latex: 'TEX',
  code: 'CODE',
  data: 'CSV',
  font: 'FONT',
  archive: 'ZIP',
  'three-d': '3D',
  image: 'IMG',
  subtitle: 'SUB',
  calendar: 'ICS',
  contact: 'VCF',
  geo: 'GEO',
  certificate: 'CERT',
  colorprofile: 'ICC',
  cad: 'DXF',
  sqlite: 'DB',
  flash: 'SWF',
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
  // 当前会话（弹层/侧边栏标签归属）；useSessionHistory 在任务页挂载时写入
  const sessionId = useStore((s) => s.activeTaskId) ?? '';
  const openPreview = useOpenFilePreview();
  // 初值取 objectURL 缓存：同一图片已加载过（再次进入会话）时首帧即缩略图，不再先图标后图片
  const [thumbUrl, setThumbUrl] = useState<string | null>(() =>
    kind === 'image' ? getCachedObjectUrl(path) : null,
  );

  const supported = kind !== 'unknown' && kind !== 'text';

  // 图片：卡片内直接加载缩略（命中缓存则跳过请求）
  useEffect(() => {
    if (kind !== 'image') return;
    const cached = getCachedObjectUrl(path);
    if (cached !== null) {
      setThumbUrl(cached);
      return;
    }
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
    <button
      type="button"
      onClick={() => openPreview(sessionId, path)}
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
  );
}
