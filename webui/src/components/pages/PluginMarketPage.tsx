// UI/src/components/pages/PluginMarketPage.tsx
// 插件库：两 tab 路由化
//   /plugins/skills（技能，默认）| /plugins/mcp（MCP 服务器）

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Search, WandSparkles, Wrench, Cable,
  Loader2, Plus, RefreshCw, Trash2, PlugZap, Unplug,
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useSkills } from '../../hooks/useSkills';
import { useMcp } from '../../hooks/useMcp';
import { api } from '../../api/http';
import type { McpServer } from '../../types/api';

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

  // 当前 tab：路径后缀映射（技能为默认）
  const tab = pathname === '/plugins/mcp' ? 'mcp' : 'skills';
  // Badge 计数在布局层拉取
  const { skills } = useSkills();
  const { servers } = useMcp();

  const tabPath = (v: string) => `/plugins/${v}`;

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
            <TabsTrigger value="skills" className="gap-1.5">
              <WandSparkles className="size-3.5" />
              {t('plugins.skillsTab')}
              <Badge variant="secondary">{skills.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="mcp" className="gap-1.5">
              <Cable className="size-3.5" />
              {t('plugins.mcpTab')}
              <Badge variant="secondary">{servers.length}</Badge>
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
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t('plugins.mcpAdd')}</DialogTitle>
            <DialogDescription>{t('plugins.mcpAddDesc')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
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
          </DialogBody>
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
