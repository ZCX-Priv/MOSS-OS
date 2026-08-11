// UI/src/components/pages/PluginMarketPage.tsx
// 插件市场：阶段4.3 对接 usePlugins + useSkills，移除硬编码。
// 双 tab 路由化：/plugins（插件）| /plugins/skills（技能）

import { useState } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation, Outlet, useOutletContext } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePlugins, getPluginIconGradient } from '../../hooks/usePlugins';
import { useSkills } from '../../hooks/useSkills';
import { useTools } from '../../hooks/useTools';
import { TOOL_ICON_MAP } from '../../lib/tool-icons';
import { Wrench } from 'lucide-react';

// Outlet context 类型：搜索框 query 与 setQuery 共享给子组件
interface PluginOutletContext {
  query: string;
  setQuery: (v: string) => void;
}

export function PluginMarketPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [query, setQuery] = useState('');

  // 当前 tab：/plugins → plugins，/plugins/skills → skills，/plugins/tools → tools
  const tab = pathname === '/plugins/skills'
    ? 'skills'
    : pathname === '/plugins/tools'
      ? 'tools'
      : 'plugins';
  // Badge 计数在布局层拉取
  const { plugins } = usePlugins();
  const { skills } = useSkills();
  const { tools } = useTools();

  const tabPath = (v: string) =>
    v === 'plugins' ? '/plugins' : v === 'skills' ? '/plugins/skills' : '/plugins/tools';

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-1 border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">{t('plugins.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('plugins.subtitle')}</p>
      </div>

      {/* Tabs（路由驱动） */}
      <Tabs
        value={tab}
        onValueChange={(v) => navigate(tabPath(v))}
      >
        <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
          <TabsList>
            <TabsTrigger value="plugins" className="gap-1.5">
              {t('plugins.pluginsTab')}
              <Badge variant="secondary">{plugins.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="skills" className="gap-1.5">
              {t('plugins.skillsTab')}
              <Badge variant="secondary">{skills.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="tools" className="gap-1.5">
              {t('plugins.toolsTab')}
              <Badge variant="secondary">{tools.length}</Badge>
            </TabsTrigger>
          </TabsList>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t('plugins.searchPlaceholder')}
              className="pl-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </Tabs>

      {/* 子路由内容 */}
      <div className="flex-1 overflow-auto">
        <Outlet context={{ query, setQuery } satisfies PluginOutletContext} />
      </div>
    </div>
  );
}

/* ===== 插件 tab ===== */
export function PluginsTab() {
  const { t } = useTranslation();
  const { query } = useOutletContext<PluginOutletContext>();
  const { plugins, togglePlugin } = usePlugins();

  const q = query.trim().toLowerCase();
  const filteredPlugins = q
    ? plugins.filter(
        (p) =>
          p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
      )
    : plugins;

  return (
    <div className="p-6">
      <div className="flex flex-col gap-2">
        {filteredPlugins.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t('plugins.noSkills', { defaultValue: '暂无插件' })}
          </div>
        )}
        {filteredPlugins.map((plugin) => {
          const gradient = plugin.iconGradient ?? getPluginIconGradient(plugin.name);
          return (
            <Card key={plugin.id} className="flex flex-row items-center gap-3 p-3">
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                style={{ backgroundImage: gradient }}
              >
                {plugin.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-foreground">{plugin.name}</h3>
                  {plugin.version && (
                    <Badge variant="secondary" className="font-normal">
                      v{plugin.version}
                    </Badge>
                  )}
                  {plugin.type === 'module' && (
                    <Badge variant="outline" className="font-normal">
                      module
                    </Badge>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {plugin.description || t('plugins.noSkills', { defaultValue: '无描述' })}
                </p>
              </div>
              <Switch
                checked={plugin.enabled}
                onCheckedChange={(checked) => void togglePlugin(plugin.id, checked)}
                aria-label={plugin.enabled ? t('common.close') : t('common.open')}
              />
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ===== 技能 tab ===== */
export function SkillsTab() {
  const { t } = useTranslation();
  const { query } = useOutletContext<PluginOutletContext>();
  const { skills } = useSkills();

  const q = query.trim().toLowerCase();
  const filteredSkills = q
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
      )
    : skills;

  return (
    <div className="p-6">
      <div className="flex flex-col gap-2">
        {filteredSkills.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t('plugins.noSkills')}
          </div>
        )}
        {filteredSkills.map((skill) => (
          <Card key={skill.name} className="flex flex-row items-center gap-3 p-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/80 to-primary text-xs font-bold text-primary-foreground">
              {skill.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-foreground">{skill.name}</h3>
              </div>
              <p className="truncate text-xs text-muted-foreground">{skill.description}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ===== 工具 tab ===== */
export function ToolsTab() {
  const { t } = useTranslation();
  const { query } = useOutletContext<PluginOutletContext>();
  const { tools, toggleTool } = useTools();

  const q = query.trim().toLowerCase();
  const filteredTools = q
    ? tools.filter(
        (tool) =>
          tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q),
      )
    : tools;

  return (
    <div className="p-6">
      <div className="flex flex-col gap-2">
        {filteredTools.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t('plugins.noTools')}
          </div>
        )}
        {filteredTools.map((tool) => {
          const Icon = TOOL_ICON_MAP[tool.icon ?? ''] ?? Wrench;
          return (
            <Card key={tool.name} className="flex flex-row items-center gap-3 p-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="size-5" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-foreground">{tool.name}</h3>
                  <Badge variant="outline" className="font-normal">
                    {tool.source === 'builtin' ? t('plugins.builtin') : t('plugins.custom')}
                  </Badge>
                  {tool.annotations?.destructiveHint && (
                    <Badge variant="secondary" className="font-normal text-amber-600">
                      destructive
                    </Badge>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{tool.description}</p>
              </div>
              <Switch
                checked={tool.enabled}
                onCheckedChange={(checked) => void toggleTool(tool.name, checked)}
                aria-label={tool.enabled ? t('common.close') : t('common.open')}
              />
            </Card>
          );
        })}
      </div>
    </div>
  );
}
