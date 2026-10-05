// render/text/FallbackPreview.tsx
// 通用兜底预览：用于「无前端渲染方案」的格式（office-odf / office-legacy / 非 epub 电子书 / 未知类型）。
// 行为：展示文件名 + 下载按钮；磁盘源若后端支持文本提取，则自动提取并以纯文本展示。
// 内存源（压缩包内层）不触发后端文本提取，直接展示已有文本或提示。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileWarning } from 'lucide-react';
import { fetchExtractedText, fetchFileBuffer } from '../file/fetcher';
import { extractArchiveEntryByPath } from '../archive/libarchive';
import { nameOfSource, type PreviewSource } from '../core/source';

export interface FallbackPreviewProps {
  /** 内容源（磁盘路径或内存） */
  source: PreviewSource;
  /** 展示用文件名 */
  fileName: string;
  /** 是否尝试后端文本提取（未知类型为 false，避免必然 415） */
  autoExtract?: boolean;
}

type TextState =
  | { status: 'loading' }
  | { status: 'ok'; text: string; truncated: boolean }
  | { status: 'unavailable' };

export function FallbackPreview({ source, fileName, autoExtract = true }: FallbackPreviewProps) {
  const { t } = useTranslation();
  // 内存源无后端文本提取能力
  const canExtract = autoExtract && source.kind === 'path';
  const [state, setState] = useState<TextState>({ status: canExtract ? 'loading' : 'unavailable' });

  useEffect(() => {
    if (!canExtract || source.kind !== 'path') {
      setState({ status: 'unavailable' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    void fetchExtractedText(source.path)
      .then((r) => {
        if (cancelled) return;
        setState(r.text.trim() ? { status: 'ok', text: r.text, truncated: r.truncated } : { status: 'unavailable' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [source, canExtract]);

  const onDownload = async () => {
    try {
      let buf: ArrayBuffer | null = null;
      if (source.kind === 'memory') buf = source.buffer ?? null;
      else if (source.kind === 'path') buf = await fetchFileBuffer(source.path);
      else buf = await extractArchiveEntryByPath(source.archivePath, source.innerPath);
      if (!buf) return;
      const url = URL.createObjectURL(new Blob([buf]));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      // 下载失败静默（越权/不存在）
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <FileWarning className="size-4 shrink-0" />
          <span className="truncate font-mono" title={nameOfSource(source)}>
            {fileName}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void onDownload()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
        >
          <Download className="size-3.5" />
          {t('preview.download')}
        </button>
      </div>

      {state.status === 'loading' && (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t('preview.loading')}
        </div>
      )}

      {state.status === 'unavailable' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <FileWarning className="size-6" />
          <div className="text-sm">{t('preview.fallbackHint')}</div>
          <div className="text-xs">{t('preview.noTextAvailable')}</div>
        </div>
      )}

      {state.status === 'ok' && (
        <div className="flex min-h-0 flex-1 flex-col gap-1">
          <div className="shrink-0 text-[11px] font-medium text-muted-foreground">
            {t('preview.extractedTextTitle')}
          </div>
          {state.truncated && (
            <div className="shrink-0 rounded border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
              {t('preview.extractedTruncated', { chars: state.text.length })}
            </div>
          )}
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/20 p-3 font-mono text-xs leading-relaxed text-foreground">
            {state.text}
          </pre>
        </div>
      )}
    </div>
  );
}