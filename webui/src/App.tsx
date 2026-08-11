import { useState, useCallback, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import type { OverlayType } from './types';
import { Sidebar } from './components/layout/Sidebar';
import { TaskPage } from './components/pages/TaskPage';
import {
  PluginMarketPage,
  PluginsTab,
  SkillsTab,
  ToolsTab,
} from './components/pages/PluginMarketPage';
import {
  AutomationPage,
  TemplatesTab,
  ConfiguredTab,
  HistoryTab,
} from './components/pages/AutomationPage';
import {
  SettingsPage,
  GeneralSettings,
  AgentSettings,
  ModelSettings,
  AboutSettings,
  PlaceholderSection,
} from './components/pages/SettingsPage';
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

  const [overlay, setOverlay] = useState<OverlayType>(null);
  const { pathname } = useLocation();

  const openOverlay = useCallback((o: OverlayType) => {
    setOverlay(o);
  }, []);

  const closeOverlay = useCallback(() => {
    setOverlay(null);
  }, []);

  // 路由切换时关闭 overlay（替代原 navigate() 内的 setOverlay(null) 副作用）
  useEffect(() => {
    setOverlay(null);
  }, [pathname]);

  return (
    <TooltipProvider>
      <SidebarProvider className="h-svh min-h-0 overflow-hidden">
        <Sidebar onOpenOverlay={openOverlay} />
        <SidebarInset className="min-h-0 overflow-hidden">
          {/* 移动端顶部 trigger 入口（Sheet 关闭时可见） */}
          <header className="flex h-12 items-center gap-2 border-b px-3 md:hidden">
            <SidebarTrigger />
          </header>
          <Routes>
            <Route path="/" element={<TaskPage onOpenOverlay={openOverlay} />} />
            <Route path="/task/:taskId" element={<TaskPage onOpenOverlay={openOverlay} />} />
            <Route path="/plugins" element={<PluginMarketPage />}>
              <Route index element={<PluginsTab />} />
              <Route path="skills" element={<SkillsTab />} />
              <Route path="tools" element={<ToolsTab />} />
              <Route path="*" element={<Navigate to="." replace />} />
            </Route>
            <Route path="/automation" element={<AutomationPage />}>
              <Route index element={<Navigate to="templates" replace />} />
              <Route path="templates" element={<TemplatesTab />} />
              <Route path="configured" element={<ConfiguredTab />} />
              <Route path="history" element={<HistoryTab />} />
              <Route path="*" element={<Navigate to="templates" replace />} />
            </Route>
            <Route path="/settings" element={<SettingsPage />}>
              <Route index element={<Navigate to="general" replace />} />
              <Route path="general" element={<GeneralSettings />} />
              <Route path="agent" element={<AgentSettings />} />
              <Route path="model" element={<ModelSettings />} />
              <Route path="about" element={<AboutSettings />} />
              <Route path="chat" element={<PlaceholderSection section="chat" />} />
              <Route path="index" element={<PlaceholderSection section="index" />} />
              <Route path="docs" element={<PlaceholderSection section="docs" />} />
              <Route path="skills" element={<PlaceholderSection section="skills" />} />
              <Route path="commands" element={<PlaceholderSection section="commands" />} />
              <Route path="rules" element={<PlaceholderSection section="rules" />} />
              <Route path="memory" element={<PlaceholderSection section="memory" />} />
              <Route path="hooks" element={<PlaceholderSection section="hooks" />} />
              <Route path="*" element={<Navigate to="general" replace />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SidebarInset>

        {/* 受控 overlay：各组件自带 Dialog/Sheet，由 overlay state 驱动开关 */}
        <SearchModal open={overlay === 'search'} onClose={closeOverlay} />
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
