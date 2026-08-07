// UI/src/components/pages/PluginMarketPage.tsx
// 插件市场：阶段4.3 对接 usePlugins + useSkills，移除硬编码。

import { useState } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PageType } from '../../types';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { usePlugins, getPluginIconGradient } from '../../hooks/usePlugins';
import { useSkills } from '../../hooks/useSkills';

interface PluginMarketPageProps {
  onNavigate: (page: PageType) => void;
}

type ManageSubTab = 'plugins' | 'skills';

export function PluginMarketPage({ onNavigate: _onNavigate }: PluginMarketPageProps) {
  const { t } = useTranslation();
  const [manageTab, setManageTab] = useState<ManageSubTab>('plugins');
  const [query, setQuery] = useState('');
  const { plugins, togglePlugin } = usePlugins();
  const { skills } = useSkills();

  const q = query.trim().toLowerCase();
  const filteredPlugins = q
    ? plugins.filter(
        (p) =>
          p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
      )
    : plugins;
  const filteredSkills = q
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
      )
    : skills;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-1 border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">{t('plugins.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('plugins.subtitle')}</p>
      </div>

      {/* Tabs */}
      <Tabs
        value={manageTab}
        onValueChange={(v) => setManageTab(v as ManageSubTab)}
        className="flex flex-1 flex-col overflow-hidden"
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

        <TabsContent value="plugins" className="flex-1 overflow-auto p-6">
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
        </TabsContent>

        <TabsContent value="skills" className="flex-1 overflow-auto p-6">
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
                    <Badge variant="outline" className="font-normal">
                      {skill.source}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{skill.description}</p>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
