import { useState, useCallback } from 'react';
import { useStore } from './store';
import type { PageType, OverlayType } from './types';
import { Sidebar } from './components/layout/Sidebar';
import { HomePage } from './components/pages/HomePage';
import { TaskRunningPage } from './components/pages/TaskRunningPage';
import { PluginMarketPage } from './components/pages/PluginMarketPage';
import { AutomationPage } from './components/pages/AutomationPage';
import { SettingsPage } from './components/pages/SettingsPage';
import { SearchModal } from './components/overlays/SearchModal';
import { AgentSwitchMenu } from './components/overlays/AgentSwitchMenu';
import { FileReferenceMenu } from './components/overlays/FileReferenceMenu';
import { PluginDropdown } from './components/dialogs/PluginDropdown';
import { SlashCommandMenu } from './components/dialogs/SlashCommandMenu';
import { PlanModeInput } from './components/dialogs/PlanModeInput';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { useWebSocket } from './hooks/useWebSocket';
import { useConfig } from './hooks/useConfig';
import { useTools } from './hooks/useTools';

export default function App() {
  // 阶段1.6：WS 连接初始化 + 事件分发（单例，全应用只调用一次）
  useWebSocket();
  // 阶段2.1：全局加载 appConfig + apiConfig
  useConfig();
  // 拉取工具图标映射（toolName → icon 字符串），供工具调用卡片渲染
  useTools();

  const [currentPage, setCurrentPage] = useState<PageType>('home');
  const [overlay, setOverlay] = useState<OverlayType>(null);
  // 统一消费 store 的 activeTaskId，避免双状态源不同步（HomePage 经 useChat 只更新 store）
  const activeTaskId = useStore((s) => s.activeTaskId ?? '');

  const navigate = useCallback((page: PageType) => {
    setCurrentPage(page);
    setOverlay(null);
  }, []);

  const openOverlay = useCallback((o: OverlayType) => {
    setOverlay(o);
  }, []);

  const closeOverlay = useCallback(() => {
    setOverlay(null);
  }, []);

  const openTask = useCallback((taskId: string) => {
    useStore.getState().setActiveTaskId(taskId);
    setCurrentPage('task');
  }, []);

  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <HomePage onNavigate={navigate} onOpenOverlay={openOverlay} />;
      case 'task':
        return (
          <TaskRunningPage
            onNavigate={navigate}
            onOpenOverlay={openOverlay}
            taskId={activeTaskId}
          />
        );
      case 'plugins':
        return <PluginMarketPage onNavigate={navigate} />;
      case 'automation':
        return <AutomationPage onNavigate={navigate} />;
      case 'settings':
        return <SettingsPage onNavigate={navigate} />;
      default:
        return <HomePage onNavigate={navigate} onOpenOverlay={openOverlay} />;
    }
  };

  return (
    <TooltipProvider>
      <SidebarProvider className="h-svh min-h-0 overflow-hidden">
        <Sidebar
          currentPage={currentPage}
          onNavigate={navigate}
          onOpenTask={openTask}
          activeTaskId={activeTaskId}
          onOpenOverlay={openOverlay}
        />
        <SidebarInset className="min-h-0 overflow-hidden">
          {/* 移动端顶部 trigger 入口（Sheet 关闭时可见） */}
          <header className="flex h-12 items-center gap-2 border-b px-3 md:hidden">
            <SidebarTrigger />
          </header>
          {renderPage()}
        </SidebarInset>

        {/* 受控 overlay：各组件自带 Dialog/Sheet，由 overlay state 驱动开关 */}
        <SearchModal
          open={overlay === 'search'}
          onClose={closeOverlay}
          onOpenTask={openTask}
        />
        <AgentSwitchMenu open={overlay === 'agent-switch'} onClose={closeOverlay} />
        <FileReferenceMenu open={overlay === 'file-reference'} onClose={closeOverlay} />
        <PluginDropdown open={overlay === 'plugin-dropdown'} onClose={closeOverlay} />
        <SlashCommandMenu open={overlay === 'slash-command'} onClose={closeOverlay} />
        <PlanModeInput open={overlay === 'plan-mode'} onClose={closeOverlay} />
      </SidebarProvider>
      <Toaster position="top-center" />
    </TooltipProvider>
  );
}
