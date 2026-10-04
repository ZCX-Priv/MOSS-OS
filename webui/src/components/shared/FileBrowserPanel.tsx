// components/shared/FileBrowserPanel.tsx
// 文件浏览器面板（右侧面板「文件」标签）。
// 以当前工作目录为「导航根」：可逐级进入子目录、返回上级；不能上溯越过根，也不能回到磁盘根。
// 地址栏 = 灰色只读的根前缀 + 可编辑的子路径后缀（根之后可改，根之前不可改）。
// 点击文件经 openFileTab 在右侧面板新建「文件预览」标签（复用 file 类型 + FilePreviewPane）。
// 数据源 GET /api/filesystem/list（root 边界由服务端强制，越界返回 403）。

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ArrowUp, Folder, Loader2, RotateCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileTypeIcon } from './FileTypeIcon';
import { useStore } from '../../store';
import { api } from '../../api/http';
import type { DirectoryListing } from '../../types/api';

export interface FileBrowserPanelProps {
  /** 会话 id（= taskId）；用于打开文件标签与会话级面板控制 */
  sessionId: string;
}

/**
 * 每会话浏览位置记忆（模块级内存）。
 * 面板随标签激活状态挂载/卸载：点文件打开预览标签会卸载本面板，切回时若无记忆会被
 * 拉回根、丢失所在子目录 → 按会话记住位置用于恢复。
 * 同时记录当时的 workingDirectory：工作目录变了则记忆失效（旧路径可能已越界到新根之外）。
 */
const lastBySession = new Map<string, { wd: string; root: string; path: string }>();

/** 文件大小人性化（1024 进制，保留 1 位小数） */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** 根 → 目标目录的相对路径（统一 / 显示；目标即根时返回空串） */
function relPath(root: string, full: string): string {
  const r = root.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  const f = full.replace(/\\/g, '/');
  if (!r || !f || f === r) return '';
  return f.startsWith(`${r}/`) ? f.slice(r.length + 1) : '';
}

/** 根显示形式：末尾用 \ 闭合（根自身即完整闭合路径，避免空尾） */
function rootDisplay(root: string): string {
  if (!root) return '';
  return /[\\/]$/.test(root) ? root : `${root}\\`;
}

/** 后缀显示形式：\ 分隔且末尾闭合（根时为空串，闭合由根前缀负责） */
function toSuffixDisplay(root: string, full: string): string {
  const rel = relPath(root, full); // 'a/b' 或 ''
  if (!rel) return '';
  return `${rel.replace(/\//g, '\\')}\\`;
}

/** 拼接根 + 后缀（去首尾分隔符后拼接；空后缀 = 根；盘符根回补分隔符） */
function joinPath(root: string, suffix: string): string {
  const base = root.replace(/[\\/]+$/, '');
  const tail = suffix.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
  if (!tail) return base.endsWith(':') ? `${base}\\` : base;
  return `${base}/${tail}`;
}

/** 路径等价比较（忽略大小写、分隔符差异与末尾斜杠） */
function samePathLoose(a: string, b: string): boolean {
  const key = (p: string): string => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
  return key(a) === key(b);
}

export function FileBrowserPanel({ sessionId }: FileBrowserPanelProps) {
  const { t } = useTranslation();
  const workingDirectory = useStore((s) => s.workingDirectory);
  const openFileTab = useStore((s) => s.openFileTab);
  const setRightPanelOpen = useStore((s) => s.setRightPanelOpen);

  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 地址栏可编辑部分：相对根的子路径 */
  const [subPath, setSubPath] = useState('');

  const load = useCallback(
    async (target: string | null, root: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const resp = await api.listDirectory(
          target ?? undefined,
          workingDirectory || undefined,
          root ?? undefined,
        );
        setListing(resp);
        setSubPath(toSuffixDisplay(resp.root, resp.path));
        lastBySession.set(sessionId, { wd: workingDirectory, root: resp.root, path: resp.path });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [workingDirectory, sessionId],
  );

  // 进入标签：同一工作目录下恢复该会话上次位置；否则首次定位（后端以工作目录为根）
  useEffect(() => {
    const rec = lastBySession.get(sessionId);
    if (rec && rec.wd === workingDirectory) void load(rec.path, rec.root);
    else void load(null, null);
  }, [load, sessionId, workingDirectory]);

  const handleOpenFile = useCallback(
    (path: string) => {
      openFileTab(sessionId, path);
      setRightPanelOpen(sessionId, true);
    },
    [openFileTab, setRightPanelOpen, sessionId],
  );

  /** 提交子路径：仅在根范围内跳转（越界由后端 403 拦下并在错误区展示） */
  const submitSubPath = useCallback(() => {
    if (!listing) return;
    void load(joinPath(listing.root, subPath.trim()), listing.root);
  }, [listing, subPath, load]);

  /** 已在导航根（上级按钮禁用；后端在根时 parent 为 null，双保险） */
  const atRoot = !!listing && relPath(listing.root, listing.path) === '';

  // 地址栏内容 ≠ 当前所在目录 → 视为有未提交的新地址（右侧按钮变为「前进」）
  const typedTarget = listing ? joinPath(listing.root, subPath.trim()) : null;
  const jumpPending = !!listing && !!typedTarget && !samePathLoose(typedTarget, listing.path);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 工具条：上级 / 地址（灰显根 + 可编辑子路径）/ 刷新（有未提交地址时变为前进） */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border p-2">
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('fileBrowser.parent')}
          aria-label={t('fileBrowser.parent')}
          disabled={atRoot || !listing?.parent || loading}
          onClick={() => void load(listing?.parent ?? null, listing?.root ?? null)}
        >
          <ArrowUp className="size-4" />
        </Button>
        {/* 地址栏：根前缀只读灰显（不可改），其后子路径可编辑 */}
        <div className="flex h-8 min-w-0 flex-1 items-center overflow-hidden rounded-lg border border-input bg-muted/40 px-2">
          <span
            className="max-w-[50%] shrink-0 truncate font-mono text-xs text-muted-foreground"
            title={listing ? rootDisplay(listing.root) : ''}
          >
            {listing ? rootDisplay(listing.root) : ''}
          </span>
          <input
            className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none"
            value={subPath}
            onChange={(e) => setSubPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitSubPath();
            }}
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          title={jumpPending ? t('fileBrowser.go') : t('fileBrowser.refresh')}
          aria-label={jumpPending ? t('fileBrowser.go') : t('fileBrowser.refresh')}
          disabled={loading}
          onClick={() => {
            if (jumpPending) submitSubPath();
            else void load(listing?.path ?? null, listing?.root ?? null);
          }}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : jumpPending ? (
            <ArrowRight className="size-4" />
          ) : (
            <RotateCw className="size-4" />
          )}
        </Button>
      </div>

      {/* 条目数超上限截断提示 */}
      {listing?.truncated && (
        <div className="shrink-0 border-b border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
          {t('fileBrowser.truncated')}
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        {error ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-destructive">
            <TriangleAlert className="size-5" />
            <span className="break-all text-xs">{error}</span>
          </div>
        ) : !listing && loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-xs">{t('fileBrowser.loading')}</span>
          </div>
        ) : listing && listing.entries.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            {t('fileBrowser.empty')}
          </div>
        ) : listing ? (
          <div className="flex flex-col gap-0.5 p-1.5">
            {listing.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                title={entry.path}
                onClick={() => {
                  if (entry.kind === 'directory') void load(entry.path, listing.root);
                  else handleOpenFile(entry.path);
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
              >
                {entry.kind === 'directory' ? (
                  <Folder className="size-4 shrink-0 text-primary-strong" />
                ) : (
                  <FileTypeIcon fileName={entry.name} size={16} className="shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">{entry.name}</span>
                {entry.kind === 'file' && (
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {formatSize(entry.size)}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : null}
      </ScrollArea>
    </div>
  );
}