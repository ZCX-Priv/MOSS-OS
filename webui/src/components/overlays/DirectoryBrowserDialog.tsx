// webui/src/components/overlays/DirectoryBrowserDialog.tsx
// 内置目录浏览器弹窗：无原生文件夹对话框的平台（如 Android / Termux）下，
// 复用后端 /api/filesystem/drives 与 /api/filesystem/list 逐级浏览并选中绝对路径。
// 数据边界由后端 filesys 权限体系强制（越界 403），本组件只做展示与导航。

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Folder, HardDrive, Loader2, RotateCw, TriangleAlert } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api } from '@/api/http';
import type { DirectoryListing, DriveInfo } from '@/types/api';

interface DirectoryBrowserDialogProps {
  open: boolean;
  onSelect: (path: string) => void;
  onClose: () => void;
}

type BrowserView = 'drives' | 'dir';

export function DirectoryBrowserDialog({ open, onSelect, onClose }: DirectoryBrowserDialogProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<BrowserView>('drives');
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 驱动器/卷标签（与 FileBrowserPanel 保持一致） */
  const driveLabelOf = (drive: DriveInfo): string => {
    switch (drive.kind) {
      case 'drive':
        return t('fileBrowser.driveLabel', { letter: drive.letter });
      case 'root':
        return t('fileBrowser.filesystemRoot');
      case 'home':
        return t('fileBrowser.homeDir');
      default:
        return drive.letter; // volume / storage：卷名或挂载路径
    }
  };

  const loadDrives = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.listDrives();
      setDrives(resp.drives);
      setListing(null);
      setView('drives');
      setInputValue('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      // cwd 缺省即 __system__，全盘可浏览；越界由后端 403 拦下
      const resp = await api.listDirectory(path);
      setListing(resp);
      setView('dir');
      setInputValue(resp.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 打开时重置到「本机」视图并加载驱动器列表
  useEffect(() => {
    if (open) void loadDrives();
  }, [open, loadDrives]);

  const handleUp = useCallback(() => {
    if (view === 'drives') return;
    if (listing?.parent) void loadDirectory(listing.parent);
    else void loadDrives();
  }, [view, listing, loadDirectory, loadDrives]);

  const submitInput = useCallback(() => {
    const typed = inputValue.trim();
    if (typed) void loadDirectory(typed);
  }, [inputValue, loadDirectory]);

  const canSelect = view === 'dir' && !!listing && !loading;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('directoryPicker.browseTitle')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {/* 工具条：上级 + 路径输入 + 刷新 */}
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('fileBrowser.parent')}
              aria-label={t('fileBrowser.parent')}
              disabled={view === 'drives' || loading}
              onClick={handleUp}
            >
              <ArrowUp className="size-4" />
            </Button>
            <input
              className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-muted/40 px-2 font-mono text-xs text-foreground outline-none"
              value={inputValue}
              placeholder={t('directoryPicker.pathHint')}
              disabled={view === 'drives'}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitInput();
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('fileBrowser.refresh')}
              aria-label={t('fileBrowser.refresh')}
              disabled={loading}
              onClick={() => {
                if (view === 'drives') void loadDrives();
                else if (listing) void loadDirectory(listing.path);
              }}
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
            </Button>
          </div>

          {error ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-destructive">
              <TriangleAlert className="size-5" />
              <span className="break-all text-xs">{error}</span>
            </div>
          ) : loading && view === 'drives' && drives.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span className="text-xs">{t('fileBrowser.loading')}</span>
            </div>
          ) : (
            <ScrollArea className="max-h-[50dvh]">
              <div className="flex flex-col gap-0.5 pr-2">
                {view === 'drives'
                  ? drives.map((drive) => (
                      <button
                        key={drive.path}
                        type="button"
                        title={drive.path}
                        onClick={() => void loadDirectory(drive.path)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <HardDrive className="size-4 shrink-0 text-primary-strong" />
                        <span className="min-w-0 flex-1 truncate">{driveLabelOf(drive)}</span>
                      </button>
                    ))
                  : (listing?.entries.filter((e) => e.kind === 'directory') ?? []).map((entry) => (
                      <button
                        key={entry.path}
                        type="button"
                        title={entry.path}
                        onClick={() => void loadDirectory(entry.path)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <Folder className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      </button>
                    ))}
                {!loading && !error && view === 'dir' && (listing?.entries.filter((e) => e.kind === 'directory').length ?? 0) === 0 && (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {t('fileBrowser.empty')}
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('directoryPicker.manualInput')}
          </Button>
          <Button disabled={!canSelect} onClick={() => listing && onSelect(listing.path)}>
            {t('directoryPicker.selectCurrent')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
