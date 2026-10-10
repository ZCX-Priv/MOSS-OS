// hooks/useOpenFilePreview.ts
// 统一的「打开文件预览」决策入口。
//
// 规则（桌面端 / 移动端分离）：
//  - 桌面端：一律在右侧边栏打开「文件预览」标签（不存在弹窗预览）。
//  - 移动端：仅来自侧边栏内部（文件浏览器、压缩包内层条目）的点击仍在侧边栏打开；
//    其余入口（消息附件卡片、@提及、消息/思考里的文件卡片等）一律走弹层预览。
//
// 说明：文件浏览器（FileBrowserPanel）与压缩包（ArchivePane）本身即位于侧边栏内，
// 它们直接调用 openFileTab（等价于 fromSidebar=true），无需经过本 hook。

import { useCallback } from 'react';
import { useStore } from '../store';
import { useIsMobile } from './use-mobile';

export interface OpenFilePreviewOptions {
  /** 是否来自右侧边栏内部（移动端保持侧边栏打开；桌面端恒为侧边栏） */
  fromSidebar?: boolean;
}

export type OpenFilePreview = (
  sessionId: string,
  path: string,
  opts?: OpenFilePreviewOptions,
) => void;

/**
 * 返回打开文件预览的函数：按平台与来源决定「侧边栏标签」或「弹层预览」。
 */
export function useOpenFilePreview(): OpenFilePreview {
  const isMobile = useIsMobile();
  const openFileTab = useStore((s) => s.openFileTab);
  const setRightPanelOpen = useStore((s) => s.setRightPanelOpen);
  const showFilePreviewDialog = useStore((s) => s.showFilePreviewDialog);

  return useCallback(
    (sessionId: string, path: string, opts?: OpenFilePreviewOptions) => {
      if (!isMobile || opts?.fromSidebar) {
        openFileTab(sessionId, path);
        setRightPanelOpen(sessionId, true);
        return;
      }
      showFilePreviewDialog(path);
    },
    [isMobile, openFileTab, setRightPanelOpen, showFilePreviewDialog],
  );
}