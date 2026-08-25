import { useState, useCallback, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Search } from 'lucide-react';
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
  FileIndexSettings,
  AppearanceSettings,
  ToolsSettings,
  SpecsSettings,
  SafetySettings,
  LogsSettings,
  AboutSettings,
  CommandsSettings,
  RenderSettingsSection,
  AnimSettingsSection,
  AppearanceSettingsSection,
  RulesSettingsSection,
  HooksSettingsSection,
  MemorySettingsSection,
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
import { useSkills } from './hooks/useSkills';
import { useAgents } from './hooks/useAgents';
import { useCommands } from './hooks/useCommands';
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
  // / @ 菜单数据预载（skills / agents / commands）：根组件一次性拉取，
  // WS resources.changed 自动刷新——首页输入 / @ 即有数据，不再依赖特定页面挂载
  useSkills();
  useAgents();
  useCommands();

  const [overlay, setOverlay] = useState<OverlayType>(null);
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const openAutomationForm = useStore((s) => s.openAutomationForm);
  // 外观设置：从 store 读取，变化时同步到 DOM（CSS 变量 / data 属性）
  const accentColor = useStore((s) => s.accentColor);
  const fontSize = useStore((s) => s.fontSize);
  const uiDensity = useStore((s) => s.uiDensity);
  const cornerRadius = useStore((s) => s.cornerRadius);
  const sidebarStyle = useStore((s) => s.sidebarStyle);
  // TaskPage 自带含左 trigger 的合并 header，全局移动端 header 仅在其他路由显示
  const isTaskRoute = pathname === '/' || pathname.startsWith('/task');
  // 移动端 header 标题与右侧 button（仅非 TaskPage 路由）
  const isPluginsRoute = pathname.startsWith('/plugins');
  const isPluginsMcpRoute = pathname === '/plugins/mcp';
  const isPluginsSkillsRoute = pathname === '/plugins' || pathname === '/plugins/skills';
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

  // 外观设置 → DOM 同步：主题色覆盖 CSS 变量、字号设 root font-size、密度/圆角/侧栏设 data 属性
  useEffect(() => {
    const root = document.documentElement;
    const ACCENT_PRESETS: Record<string, string> = {
      blue: 'oklch(0.546 0.245 263.4)',
      green: 'oklch(0.627 0.194 149.2)',
      purple: 'oklch(0.541 0.281 293.0)',
      orange: 'oklch(0.646 0.222 41.0)',
      rose: 'oklch(0.586 0.225 16.5)',
      teal: 'oklch(0.6 0.118 184.5)',
    };
    const color = accentColor.startsWith('#')
      ? accentColor
      : (ACCENT_PRESETS[accentColor] ?? ACCENT_PRESETS.blue);
    root.style.setProperty('--primary', color);
    root.style.setProperty('--primary-strong', color);
    root.style.setProperty('--ring', color);
    root.style.setProperty('--sidebar-primary', color);
    root.style.setProperty('--sidebar-ring', color);
    root.style.setProperty('--chart-1', color);
    root.style.setProperty('--chart-2', color);

    const FONT_SIZE_MAP: Record<string, string> = {
      small: '13px',
      medium: '14px',
      large: '16px',
    };
    root.style.fontSize = FONT_SIZE_MAP[fontSize] ?? FONT_SIZE_MAP.medium;

    root.setAttribute('data-density', uiDensity);

    const RADIUS_MAP: Record<string, string> = {
      small: '0.375rem',
      standard: '0.625rem',
      large: '0.875rem',
    };
    root.style.setProperty('--radius', RADIUS_MAP[cornerRadius] ?? RADIUS_MAP.standard);

    root.setAttribute('data-sidebar-style', sidebarStyle);
  }, [accentColor, fontSize, uiDensity, cornerRadius, sidebarStyle]);

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
                {/* 插件库技能 tab：刷新 + 添加技能（移动端收纳进 header，页面内按钮在桌面头部） */}
                {isPluginsSkillsRoute && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t('common.refresh')}
                      aria-label={t('common.refresh')}
                      onClick={() => useStore.getState().requestSkillsRefresh()}
                    >
                      <RefreshCw />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t('plugins.skillsAdd')}
                      aria-label={t('plugins.skillsAdd')}
                      onClick={() => useStore.getState().requestSkillsDialog()}
                    >
                      <Plus />
                    </Button>
                  </>
                )}
                {/* 插件库 MCP tab：刷新 + 添加服务器（移动端收纳进 header，页面内按钮在桌面头部） */}
                {isPluginsMcpRoute && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t('common.refresh')}
                      aria-label={t('common.refresh')}
                      onClick={() => useStore.getState().requestMcpRefresh()}
                    >
                      <RefreshCw />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t('plugins.mcpAdd')}
                      aria-label={t('plugins.mcpAdd')}
                      onClick={() => useStore.getState().requestMcpDialog()}
                    >
                      <Plus />
                    </Button>
                  </>
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
                <Route index element={<AppearanceSettingsSection />} />
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
                <Route path="index" element={<FileIndexSettings />} />
                <Route path="rules" element={<RulesSettingsSection />} />
                <Route path="memory" element={<MemorySettingsSection />} />
              </Route>
              <Route path="tools" element={<ToolsSettings />} />
              <Route path="safety" element={<SafetySettings />} />
              <Route path="logs" element={<LogsSettings />} />
              <Route path="about" element={<AboutSettings />} />
              <Route path="commands" element={<CommandsSettings />} />
              <Route path="hooks" element={<HooksSettingsSection />} />
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
