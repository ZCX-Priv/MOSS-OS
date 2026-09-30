// render/archive/ArchivePreview.tsx
// 压缩包预览：zip 列出条目（名称/目录树缩进）；其余格式（tar/gz/7z/rar）回退提示。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Download, File as FileIcon, Folder } from 'lucide-react';

export interface ArchivePreviewProps {
  buffer: ArrayBuffer;
  ext: string;
  fileName: string;
}

interface ArchiveEntry {
  name: string;
  dir: boolean;
}

export function ArchivePreview({ buffer, ext, fileName }: ArchivePreviewProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isZip = ext.toLowerCase() === 'zip';
  const downloadUrl = useMemo(() => URL.createObjectURL(new Blob([buffer])), [buffer]);
  useEffect(() => () => URL.revokeObjectURL(downloadUrl), [downloadUrl]);

  useEffect(() => {
    if (!isZip) return;
    let cancelled = false;
    setEntries(null);
    setError(null);
    void (async () => {
      try {
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(buffer);
        if (cancelled) return;
        const list: ArchiveEntry[] = Object.values(zip.files).map((f) => ({ name: f.name, dir: f.dir }));
        list.sort((a, b) => a.name.localeCompare(b.name));
        setEntries(list);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buffer, isZip]);

  const downloadLink = (
    <a
      href={downloadUrl}
      download={fileName}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
    >
      <Download className="size-3.5" />
      {t('preview.download')}
    </a>
  );

  if (!isZip) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Archive className="size-6" />
        <div className="max-w-md text-center text-sm">{t('preview.archiveUnsupported')}</div>
        {downloadLink}
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-destructive">
        <Archive className="size-6" />
        <div className="text-sm">{error}</div>
      </div>
    );
  }

  if (entries === null) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('preview.loading')}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">{t('preview.archiveEntries', { count: entries.length })}</span>
        {downloadLink}
      </div>
      {entries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t('preview.archiveEmpty')}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded border border-border p-1">
          {entries.map((entry) => {
            const depth = Math.max(0, entry.name.replace(/\/$/, '').split('/').length - 1);
            const base = entry.name.replace(/\/$/, '').split('/').pop() ?? entry.name;
            return (
              <div
                key={entry.name}
                className="flex items-center gap-1.5 truncate py-0.5 font-mono text-xs text-foreground"
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
                title={entry.name}
              >
                {entry.dir ? (
                  <Folder className="size-3.5 shrink-0 text-primary-strong" />
                ) : (
                  <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{base}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}