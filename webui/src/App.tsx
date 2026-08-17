import { useState, useCallback, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { OverlayType } from './types';
import { Sidebar } from './components/layout/Sidebar';
import { TaskPage } from './components/pages/TaskPage';
import {
  PluginMarketPage,
  SkillsTab,
  McpTab,
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
  ToolsSettings,
  SpecsSettings,
  SafetySettings,
  AboutSettings,
  PlaceholderSection,
} from './components/pages/SettingsPage';
import { SearchModal } from './components/overlays/SearchModal';
import { AgentSwitchMenu } from './components/overlays/AgentSwitchMenu';
import { FileReferenceMenu } from './components/overlays/FileReferenceMenu';
import { SlashCommandMenu } from './components/dialogs/SlashCommandMenu';
import { PlanModeInput } from './components/dialogs/PlanModeInput';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
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
  const { t } = useTranslation();
  // TaskPage 自带含左 trigger 的合并 header，全局移动端 header 仅在其他路由显示
  const isTaskRoute = pathname === '/' || pathname.startsWith('/task');
  // 移动端 header 标题与右侧 button（仅非 TaskPage 路由）
  const isPluginsRoute = pathname.startsWith('/plugins');
  const isAutomationRoute = pathname.startsWith('/automation');
  const isSettingsRoute = pathname.startsWith('/settings');
  const mobileTitle = isPluginsRoute
    ? t('plugins.title')
    : isAutomationRoute
      ? t('automation.title')
      : isSettingsRoute
        ? t('settings.title')
        : '';

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
          {/* 移动端顶部 header：仅非 TaskPage 路由显示（TaskPage 自带含左 trigger 的 header） */}
          {!isTaskRoute && (
            <header className="grid h-12 grid-cols-3 items-center border-b border-border px-3 md:hidden">
              <SidebarTrigger />
              <h1 className="truncate text-center text-sm font-medium text-foreground">
                {mobileTitle}
              </h1>
              <div className="flex justify-end">
                {isAutomationRoute && (
                  <Button variant="ghost" size="icon-sm" title={t('automation.manualCreate')}>
                    <Plus />
                  </Button>
                )}
              </div>
            </header>
          )}
          <Routes>
            <Route path="/" element={<TaskPage onOpenOverlay={openOverlay} />} />
            <Route path="/task/:taskId" element={<TaskPage onOpenOverlay={openOverlay} />} />
            <Route path="/plugins" element={<PluginMarketPage />}>
              <Route index element={<Navigate to="skills" replace />} />
              <Route path="skills" element={<SkillsTab />} />
              <Route path="mcp" element={<McpTab />} />
              <Route path="*" element={<Navigate to="skills" replace />} />
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
              <Route path="appearance" element={<PlaceholderSection section="appearance" />} />
              <Route path="agent" element={<AgentSettings />} />
              <Route path="model" element={<ModelSettings />} />
              <Route path="tools" element={<ToolsSettings />} />
              <Route path="specs" element={<SpecsSettings />} />
              <Route path="safety" element={<SafetySettings />} />
              <Route path="about" element={<AboutSettings />} />
              <Route path="task" element={<PlaceholderSection section="task" />} />
              <Route path="index" element={<PlaceholderSection section="index" />} />
              <Route path="docs" element={<PlaceholderSection section="docs" />} />
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
        <SlashCommandMenu open={overlay === 'slash-command'} onClose={closeOverlay} />
        <PlanModeInput open={overlay === 'plan-mode'} onClose={closeOverlay} />
      </SidebarProvider>
      <Toaster position="top-center" />
    </TooltipProvider>
  );
}
