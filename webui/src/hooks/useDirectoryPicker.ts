// webui/src/hooks/useDirectoryPicker.ts
// 浏览器端文件夹选择 hook。
//
// 浏览器安全模型硬性禁止 JS 获取文件夹绝对路径（File System Access API 的 handle.name
// 只返回文件夹名）。由于 MOSS 后端在本机运行（127.0.0.1），主路径直接调后端
// POST /api/filesystem/pick-directory，后端调用系统原生文件夹选择对话框（Windows
// Shell.Application.BrowseForFolder / macOS osascript / Linux zenity），拿到用户真实
// 选择的绝对路径返回。跨盘符精准无误，不依赖搜索猜测。
//
// 回退路径：后端不可用（远程场景）或原生对话框失败时，用浏览器 API（showDirectoryPicker
// / webkitdirectory）取文件夹名，再调 resolve-directory 搜索候选绝对路径。

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useStore } from '../store';
import { api } from '../api/http';
import type { DirectoryCandidate } from '../types/api';

export function useDirectoryPicker() {
  const { t } = useTranslation();
  const setWorkingDirectory = useStore((s) => s.setWorkingDirectory);
  const addRecentDirectory = useStore((s) => s.addRecentDirectory);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [candidates, setCandidates] = useState<DirectoryCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** 用文件夹名调后端 resolve-directory 搜索候选绝对路径（回退路径专用） */
  const resolveByName = useCallback(
    async (folderName: string, hint?: string) => {
      setIsResolving(true);
      setError(null);
      try {
        const { exactMatch, candidates: list } = await api.resolveDirectory(folderName, hint);
        if (exactMatch) {
          setWorkingDirectory(exactMatch);
          addRecentDirectory(exactMatch);
          toast.success(t('directoryPicker.resolved'));
        } else if (list.length > 0) {
          setCandidates(list);
        } else {
          setWorkingDirectory(folderName);
          toast.warning(t('directoryPicker.notFound'));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setWorkingDirectory(folderName);
        toast.warning(t('directoryPicker.notFound'));
      } finally {
        setIsResolving(false);
      }
    },
    [setWorkingDirectory, addRecentDirectory, t],
  );

  /** 回退路径：浏览器 API 取文件夹名 + resolve-directory 搜索 */
  const fallbackViaBrowser = useCallback(async () => {
    // 1. 优先 File System Access API（Chrome/Edge 86+）
    if (typeof window.showDirectoryPicker === 'function') {
      try {
        const handle = await window.showDirectoryPicker({ id: 'moss-workdir', mode: 'read' });
        await resolveByName(handle.name);
        return;
      } catch (err) {
        // 用户取消 → 静默
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // 其他错误 → 继续 webkitdirectory 回退
      }
    }
    // 2. webkitdirectory（Firefox/Safari/FSAccess 失败）
    inputRef.current?.click();
  }, [resolveByName]);

  /** 触发文件夹选择：主路径调后端原生对话框，失败回退浏览器 API + 搜索 */
  const pickDirectory = useCallback(async () => {
    setError(null);
    setIsResolving(true);
    try {
      // 主路径：后端原生对话框（本机场景，跨盘符精准）
      const { path } = await api.pickDirectory();
      if (path) {
        setWorkingDirectory(path);
        addRecentDirectory(path);
        toast.success(t('directoryPicker.resolved'));
      }
      // path 为 null = 用户取消，静默
    } catch {
      // 后端不可用（远程场景）/超时/失败 → 回退浏览器 API + resolve-directory 搜索
      await fallbackViaBrowser();
    } finally {
      setIsResolving(false);
    }
  }, [setWorkingDirectory, addRecentDirectory, t, fallbackViaBrowser]);

  /** webkitdirectory input 的 change 处理（回退路径） */
  const onInputPicked = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.currentTarget.files?.[0];
      e.currentTarget.value = '';
      if (!file) return;
      const folderName = file.webkitRelativePath?.split('/')[0];
      if (!folderName) return;
      await resolveByName(folderName);
    },
    [resolveByName],
  );

  /** 从候选列表中选择一个路径 */
  const selectCandidate = useCallback(
    (path: string) => {
      setWorkingDirectory(path);
      addRecentDirectory(path);
      setCandidates([]);
      toast.success(t('directoryPicker.resolved'));
    },
    [setWorkingDirectory, addRecentDirectory, t],
  );

  const cancel = useCallback(() => setCandidates([]), []);

  return {
    inputRef,
    pickDirectory,
    onInputPicked,
    isResolving,
    candidates,
    selectCandidate,
    cancel,
    error,
  };
}
