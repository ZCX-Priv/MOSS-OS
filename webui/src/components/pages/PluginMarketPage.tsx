// UI/src/components/pages/PluginMarketPage.tsx
// 插件中心：五 tab 路由化
//   /plugins（插件）| /plugins/skills（技能）| /plugins/tools（工具）
//   | /plugins/mcp（MCP 服务器）| /plugins/specs（Spec 规范）

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Search, Puzzle, WandSparkles, Wrench, Cable, FileCode,
  Loader2, Plus, RefreshCw, Trash2, Pencil, PlugZap, Unplug,
  BookOpen, ListChecks, Eye, Lightbulb, Sparkles, ShieldAlert, FlaskConical,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation, Outlet, useOutletContext } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { usePlugins } from '../../hooks/usePlugins';
import { useSkills } from '../../hooks/useSkills';
import { useTools } from '../../hooks/useTools';
import { useMcp } from '../../hooks/useMcp';
import { useSpecs } from '../../hooks/useSpecs';
import { api } from '../../api/http';
import { TOOL_ICON_MAP } from '../../lib/tool-icons';
import type { McpServer, SpecDetail } from '../../types/api';

// Outlet context 类型：搜索框 query 与 setQuery 共享给子组件
interface PluginOutletContext {
  query: string;
  setQuery: (v: string) => void;
}

/** skill.icon（Lucide kebab-case 名）→ 图标组件；未命中回退 WandSparkles */
const SKILL_ICON_MAP: Record<string, typeof WandSparkles> = {
  'book-open': BookOpen,
  'list-checks': ListChecks,
  'eye': Eye,
  'lightbulb': Lightbulb,
  'sparkles': Sparkles,
  'shield-alert': ShieldAlert,
  'flask-conical': FlaskConical,
};

export function PluginMarketPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [query, setQuery] = useState('');

  // 当前 tab：路径后缀映射
  const tab =
    pathname === '/plugins/skills' ? 'skills'
    : pathname === '/plugins/tools' ? 'tools'
    : pathname === '/plugins/mcp' ? 'mcp'
    : pathname === '/plugins/specs' ? 'specs'
    : 'plugins';
  // Badge 计数在布局层拉取
  const { plugins } = usePlugins();
  const { skills } = useSkills();
  const { tools } = useTools();
  const { servers } = useMcp();

  const tabPath = (v: string) =>
    v === 'plugins' ? '/plugins' : `/plugins/${v}`;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="hidden flex-col gap-1 px-6 py-4 md:flex">
        <h1 className="text-xl font-semibold text-foreground">{t('plugins.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('plugins.subtitle')}</p>
      </div>

      {/* Tabs（路由驱动） */}
      <Tabs
        value={tab}
        onValueChange={(v) => navigate(tabPath(v))}
      >
        <div className="flex items-center justify-between gap-4 px-6 py-3">
          <TabsList>
            <TabsTrigger value="plugins" className="gap-1.5">
              <Puzzle className="size-3.5" />
              {t('plugins.pluginsTab')}
              <Badge variant="secondary">{plugins.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="skills" className="gap-1.5">
              <WandSparkles className="size-3.5" />
              {t('plugins.skillsTab')}
              <Badge variant="secondary">{skills.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="tools" className="gap-1.5">
              <Wrench className="size-3.5" />
              {t('plugins.toolsTab')}
              <Badge variant="secondary">{tools.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="mcp" className="gap-1.5">
              <Cable className="size-3.5" />
              {t('plugins.mcpTab')}
              <Badge variant="secondary">{servers.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="specs" className="gap-1.5">
              <FileCode className="size-3.5" />
              {t('plugins.specsTab')}
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
            {t('plugins.noPlugins')}
          </div>
        )}
        {filteredPlugins.map((plugin) => {
          return (
            <Card key={plugin.id} className="flex flex-row items-center gap-3 p-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Puzzle className="size-5" />
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
                      {t('plugins.moduleType')}
                    </Badge>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {plugin.description || t('plugins.noDescription')}
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

/* ===== 技能 tab（icon + greet + files + 启停） ===== */
export function SkillsTab() {
  const { t } = useTranslation();
  const { query } = useOutletContext<PluginOutletContext>();
  const { skills, toggleSkill } = useSkills();

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
        {filteredSkills.map((skill) => {
          const Icon = SKILL_ICON_MAP[skill.icon ?? ''] ?? WandSparkles;
          const enabled = skill.enabled !== false;
          return (
            <Card key={skill.name} className="flex flex-row items-center gap-3 p-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="size-5" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-foreground">{skill.name}</h3>
                  {skill.files && skill.files.length > 0 && (
                    <Badge variant="outline" className="font-normal">
                      {t('plugins.skillFiles', { count: skill.files.length })}
                    </Badge>
                  )}
                  {skill.greet && (
                    <Badge variant="secondary" className="max-w-48 truncate font-normal text-muted-foreground" title={skill.greet}>
                      {t('plugins.skillGreet')}
                    </Badge>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{skill.description}</p>
                <p className="truncate text-[11px] text-muted-foreground/70">
                  {t('plugins.skillUsage')}: /skill:{skill.name}
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={(checked) =>
                  void toggleSkill(skill.name, checked).catch(() => toast.error(t('plugins.skillToggleFailed')))
                }
                aria-label={enabled ? t('common.close') : t('common.open')}
              />
            </Card>
          );
        })}
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
                      {t('plugins.destructive')}
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

/* ===== MCP tab ===== */

/** 添加/编辑服务器弹窗的表单状态 */
interface McpServerForm {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command: string;
  args: string;
  url: string;
  headers: string;
}

const EMPTY_MCP_FORM: McpServerForm = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
  headers: '',
};

export function McpTab() {
  const { t } = useTranslation();
  const { query } = useOutletContext<PluginOutletContext>();
  const { servers, tools, reload, connect, disconnect, remove, setEnabled } = useMcp();

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<McpServerForm>(EMPTY_MCP_FORM);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const filteredServers = q
    ? servers.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.command ?? '').toLowerCase().includes(q) ||
          (s.url ?? '').toLowerCase().includes(q),
      )
    : servers;

  const submit = useCallback(async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      const def: Parameters<typeof api.createMcpServer>[0] = {
        name: form.name.trim(),
        transport: form.transport,
        ...(form.transport === 'stdio'
          ? {
              command: form.command.trim(),
              ...(form.args.trim()
                ? { args: form.args.trim().split(/\s+/).filter(Boolean) }
                : {}),
            }
          : { url: form.url.trim() }),
      };
      await api.createMcpServer(def);
      setAddOpen(false);
      setForm(EMPTY_MCP_FORM);
      toast.success(t('plugins.mcpCreated', { name: def.name }));
      void reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('plugins.mcpCreateFailed'));
    } finally {
      setSaving(false);
    }
  }, [form, saving, t, reload]);

  const statusColor = (s: McpServer['status']): string =>
    s === 'connected' ? 'bg-emerald-500' : s === 'error' ? 'bg-red-500' : 'bg-muted-foreground/40';

  return (
    <div className="p-6">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{t('plugins.mcpHint')}</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => void reload()}>
            <RefreshCw className="size-3.5" />
            {t('common.refresh')}
          </Button>
          <Button size="sm" className="h-8 gap-1" onClick={() => setAddOpen(true)}>
            <Plus className="size-3.5" />
            {t('plugins.mcpAdd')}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {filteredServers.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t('plugins.noMcpServers')}
          </div>
        )}
        {filteredServers.map((server) => {
          const serverTools = tools.filter((tl) => tl.server === server.name);
          const enabled = server.enabled !== false;
          return (
            <Card key={server.name} className="flex flex-col gap-2 p-3">
              <div className="flex flex-row items-center gap-3">
                <div className="relative flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Cable className="size-5" />
                  <span
                    className={statusColor(server.status)}
                    title={server.status + (server.lastError ? `: ${server.lastError}` : '')}
                    aria-label={server.status}
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-foreground">{server.name}</h3>
                    <Badge variant="outline" className="font-normal">{server.transport ?? 'stdio'}</Badge>
                    <Badge variant="secondary" className="font-normal">
                      {t('plugins.mcpToolCount', { count: server.toolCount })}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {server.transport === 'http' || server.transport === 'sse'
                      ? server.url
                      : [server.command, ...(server.args ?? [])].filter(Boolean).join(' ')}
                  </p>
                  {server.status === 'error' && server.lastError && (
                    <p className="truncate text-xs text-destructive" title={server.lastError}>
                      {server.lastError}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {server.status === 'connected' ? (
                    <Button
                      variant="ghost" size="icon-sm" title={t('plugins.mcpDisconnect')}
                      disabled={busy === server.name}
                      onClick={() => { setBusy(server.name); void disconnect(server.name).finally(() => setBusy(null)); }}
                    >
                      {busy === server.name ? <Loader2 className="size-4 animate-spin" /> : <Unplug className="size-4" />}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost" size="icon-sm" title={t('plugins.mcpConnect')}
                      disabled={busy === server.name}
                      onClick={() => { setBusy(server.name); void connect(server.name).finally(() => setBusy(null)); }}
                    >
                      {busy === server.name ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                    </Button>
                  )}
                  <Button
                    variant="ghost" size="icon-sm" title={t('common.delete')}
                    onClick={() => {
                      if (window.confirm(t('plugins.mcpDeleteConfirm', { name: server.name }))) {
                        void remove(server.name).catch((err: unknown) =>
                          toast.error(err instanceof Error ? err.message : t('plugins.mcpDeleteFailed')),
                        );
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(checked) =>
                      void setEnabled(server.name, checked).catch(() => toast.error(t('plugins.mcpToggleFailed')))
                    }
                    aria-label={enabled ? t('common.close') : t('common.open')}
                  />
                </div>
              </div>
              {/* 工具清单（可折叠）：name + annotations 徽章 */}
              {serverTools.length > 0 && (
                <details className="group rounded-md border border-border px-2 py-1.5">
                  <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                    <Wrench className="size-3" />
                    {t('plugins.mcpToolsOf', { name: server.name, count: serverTools.length })}
                  </summary>
                  <div className="mt-1.5 flex flex-col gap-1">
                    {serverTools.map((tl) => (
                      <div key={tl.name} className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-mono">{tl.name}</span>
                        {tl.annotations?.readOnlyHint && (
                          <Badge variant="outline" className="px-1 py-0 text-[10px] font-normal">RO</Badge>
                        )}
                        {tl.annotations?.destructiveHint && (
                          <Badge variant="secondary" className="px-1 py-0 text-[10px] font-normal text-amber-600">
                            {t('plugins.destructive')}
                          </Badge>
                        )}
                        {tl.description && (
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">{tl.description}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </Card>
          );
        })}
      </div>

      {/* 添加服务器弹窗 */}
      <Dialog open={addOpen} onOpenChange={(o) => !saving && setAddOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('plugins.mcpAdd')}</DialogTitle>
            <DialogDescription>{t('plugins.mcpAddDesc')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-name">{t('plugins.mcpName')}</Label>
              <Input
                id="mcp-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="github"
                disabled={saving}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('plugins.mcpTransport')}</Label>
              <Select
                value={form.transport}
                onValueChange={(v) => setForm((f) => ({ ...f, transport: v as McpServerForm['transport'] }))}
                disabled={saving}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">stdio</SelectItem>
                  <SelectItem value="http">http</SelectItem>
                  <SelectItem value="sse">sse</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.transport === 'stdio' ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="mcp-command">{t('plugins.mcpCommand')}</Label>
                  <Input
                    id="mcp-command"
                    value={form.command}
                    onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                    placeholder="npx -y @modelcontextprotocol/server-github"
                    disabled={saving}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="mcp-args">{t('plugins.mcpArgs')}</Label>
                  <Input
                    id="mcp-args"
                    value={form.args}
                    onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
                    placeholder="--port 3000 --verbose"
                    disabled={saving}
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-url">URL</Label>
                <Input
                  id="mcp-url"
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://mcp.example.com/mcp"
                  disabled={saving}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={() => void submit()} disabled={saving || !form.name.trim() || (form.transport === 'stdio' ? !form.command.trim() : !form.url.trim())}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ===== Specs tab（查看 + 编辑保存） ===== */
export function SpecsTab() {
  const { t } = useTranslation();
  const { query } = useOutletContext<PluginOutletContext>();
  const { specs } = useSpecs();

  const [detail, setDetail] = useState<SpecDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const q = query.trim().toLowerCase();
  const filteredSpecs = q
    ? specs.filter(
        (s) => s.id.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
      )
    : specs;

  const openSpec = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const resp = await api.getSpec(id);
      setDetail(resp.spec);
      setContent(resp.spec.content);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('plugins.specLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const save = useCallback(async () => {
    if (!detail || saving) return;
    setSaving(true);
    try {
      await api.updateSpec(detail.id, content);
      toast.success(t('plugins.specSaved'));
      setDetail(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('plugins.specSaveFailed'));
    } finally {
      setSaving(false);
    }
  }, [detail, content, saving, t]);

  return (
    <div className="p-6">
      <div className="flex flex-col gap-2">
        {filteredSpecs.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t('plugins.noSpecs')}
          </div>
        )}
        {filteredSpecs.map((spec) => (
          <Card
            key={spec.id}
            className="flex cursor-pointer flex-row items-center gap-3 p-3 transition-colors hover:bg-muted/40"
            onClick={() => void openSpec(spec.id)}
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <FileCode className="size-5" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-foreground">{spec.id}</h3>
                <Badge variant="outline" className="font-normal">
                  {spec.source === 'builtin' ? t('plugins.builtin') : t('plugins.custom')}
                </Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">{spec.description}</p>
            </div>
            <Pencil className="size-4 shrink-0 text-muted-foreground/50" />
          </Card>
        ))}
      </div>

      {/* 查看/编辑弹窗 */}
      <Dialog open={detail !== null || loading} onOpenChange={(o) => !o && !saving && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail ? detail.id : t('common.loading')}</DialogTitle>
            <DialogDescription>{detail?.description}</DialogDescription>
          </DialogHeader>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : detail ? (
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={saving}
              className="min-h-[50vh] font-mono text-xs"
            />
          ) : null}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDetail(null)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving || !detail}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
