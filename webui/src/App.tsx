import { useState, useCallback, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Search } from 'lucide-react';
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
  ConfiguredTab,
  HistoryTab,
} from './components/pages/AutomationPage';
import {
  SettingsPage,
  GeneralSettings,
  AgentSettings,
  ProviderSettings,
  ContextSettings,
  ContextEngineSettings,
  AppearanceSettings,
  ToolsSettings,
  SpecsSettings,
  SafetySettings,
  LogsSettings,
  AboutSettings,
  PlaceholderSection,
  RenderSettingsSection,
  AnimSettingsSection,
} from './components/pages/SettingsPage';
import { SearchModal } from './components/overlays/SearchModal';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { useWebSocket } from './hooks/useWebSocket';
import { useConfig } from './hooks/useConfig';
import { useTools } from './hooks/useTools';
import { useAnimationClass } from './hooks/useAnimationClass';
import { useStore } from './store';

export default function App() {
  // 阶段1.6：WS 连接初始化 + 事件分发（单例，全应用只调用一次）
  useWebSocket();
  // 阶段2.1：全局加载 appConfig + apiConfig
  useConfig();
  // 拉取工具图标映射（toolName → icon 字符串），供工具调用卡片渲染
  useTools();
  // 动画开关 → <html> class 桥接（含 prefers-reduced-motion 实时监听）
  useAnimationClass();

  const [overlay, setOverlay] = useState<OverlayType>(null);
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const openAutomationForm = useStore((s) => s.openAutomationForm);
  // TaskPage 自带含左 trigger 的合并 header，全局移动端 header 仅在其他路由显示
  const isTaskRoute = pathname === '/' || pathname.startsWith('/task');
  // 移动端 header 标题与右侧 button（仅非 TaskPage 路由）
  const isPluginsRoute = pathname.startsWith('/plugins');
  const isAutomationRoute = pathname.startsWith('/automation');
  const isSettingsRoute = pathname.startsWith('/settings');
  const isProviderRoute = pathname.startsWith('/settings/provider');
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
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t('automation.manualCreate')}
                    onClick={() => openAutomationForm()}
                  >
                    <Plus />
                  </Button>
                )}
                {/* 服务商设置页：搜索 + 添加（移动端收纳进 header；页面内工具行仅筛选占一行） */}
                {isProviderRoute && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t('settings.provider.searchPlaceholder')}
                      onClick={() => useStore.getState().toggleProviderSearch()}
                    >
                      <Search />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t('settings.provider.addProvider')}
                      aria-label={t('settings.provider.addProvider')}
                      onClick={() => useStore.getState().requestProviderDialog()}
                    >
                      <Plus />
                    </Button>
                  </>
                )}
              </div>
            </header>
          )}
          {/* 路由切换入场动画：按顶层路由段 remount 重播（/task/a→/task/b 同路由参数变化不重播；设置内部分区切换由各 Outlet 容器负责）。
              flex flex-col：保持父级（SidebarInset）到页面根元素的 flex 纵向链路，页面 flex-1 撑满（缺失会导致页面高度塌陷） */}
          <div
            key={pathname.split('/')[1] ?? 'home'}
            className="anim-route animate-in fade-in slide-in-from-bottom-1 duration-200 flex min-h-0 flex-1 flex-col"
          >
            <Routes>
            <Route path="/" element={<TaskPage />} />
            <Route path="/task/:taskId" element={<TaskPage />} />
            <Route path="/plugins" element={<PluginMarketPage />}>
              <Route index element={<Navigate to="skills" replace />} />
              <Route path="skills" element={<SkillsTab />} />
              <Route path="mcp" element={<McpTab />} />
              <Route path="*" element={<Navigate to="skills" replace />} />
            </Route>
            <Route path="/automation" element={<AutomationPage />}>
              <Route index element={<Navigate to="configured" replace />} />
              <Route path="configured" element={<ConfiguredTab />} />
              <Route path="history" element={<HistoryTab />} />
              <Route path="*" element={<Navigate to="configured" replace />} />
            </Route>
            <Route path="/settings" element={<SettingsPage />}>
              <Route index element={<Navigate to="general" replace />} />
              <Route path="general" element={<GeneralSettings />} />
              {/* 外观：Tab 容器（外观占位 / 渲染设置 / 动画设置） */}
              <Route path="appearance" element={<AppearanceSettings />}>
                <Route index element={<PlaceholderSection section="appearance" embedded />} />
                <Route path="render" element={<RenderSettingsSection />} />
                <Route path="anim" element={<AnimSettingsSection />} />
              </Route>
              <Route path="agent" element={<AgentSettings />} />
              <Route path="provider" element={<ProviderSettings />} />
              {/* 旧路径兼容：模型设置并入服务商 */}
              <Route path="model" element={<Navigate to="/settings/provider" replace />} />
              {/* 上下文：Tab 容器（引擎 / 规范 / 索引 / 规则 / 记忆） */}
              <Route path="context" element={<ContextSettings />}>
                <Route index element={<ContextEngineSettings />} />
                <Route path="specs" element={<SpecsSettings />} />
                <Route path="index" element={<PlaceholderSection section="index" embedded />} />
                <Route path="rules" element={<PlaceholderSection section="rules" embedded />} />
                <Route path="memory" element={<PlaceholderSection section="memory" embedded />} />
              </Route>
              <Route path="tools" element={<ToolsSettings />} />
              <Route path="safety" element={<SafetySettings />} />
              <Route path="logs" element={<LogsSettings />} />
              <Route path="about" element={<AboutSettings />} />
              <Route path="commands" element={<PlaceholderSection section="commands" />} />
              <Route path="hooks" element={<PlaceholderSection section="hooks" />} />
              {/* 旧路径重定向（并入 Tab 后保留兼容：搜索索引/书签仍指向旧地址） */}
              <Route path="render" element={<Navigate to="/settings/appearance/render" replace />} />
              <Route path="anim" element={<Navigate to="/settings/appearance/anim" replace />} />
              <Route path="specs" element={<Navigate to="/settings/context/specs" replace />} />
              <Route path="index" element={<Navigate to="/settings/context/index" replace />} />
              <Route path="rules" element={<Navigate to="/settings/context/rules" replace />} />
              <Route path="memory" element={<Navigate to="/settings/context/memory" replace />} />
              <Route path="*" element={<Navigate to="general" replace />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </SidebarInset>

        {/* 受控 overlay：各组件自带 Dialog/Sheet，由 overlay state 驱动开关 */}
        <SearchModal open={overlay === 'search'} onClose={closeOverlay} />
      </SidebarProvider>
      <Toaster position="top-center" />
    </TooltipProvider>
  );
}
