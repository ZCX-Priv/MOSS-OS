// UI/src/components/pages/PluginMarketPage.tsx
// 插件库：两 tab 路由化
//   /plugins/skills（技能，默认）| /plugins/mcp（MCP 服务器）

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Search, WandSparkles, Wrench, Cable,
  Loader2, Plus, RefreshCw, Trash2, PlugZap, Unplug,
  BookOpen, ListChecks, Eye, Lightbulb, Sparkles, ShieldAlert, FlaskConical,
  Server, Copy,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation, Outlet, useOutletContext } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import { useStore } from '../../store';
import { api } from '../../api/http';
import { ConfirmDialog } from '../shared/ConfirmDialog';
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
  const { servers, reload } = useMcp();
  const requestMcpDialog = useStore((s) => s.requestMcpDialog);

  const tabPath = (v: string) => `/plugins/${v}`;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header：左标题右操作（MCP tab 专属按钮；移动端收纳进全局顶栏，与自动化页一致） */}
      <div className="hidden items-center justify-between gap-4 px-6 py-4 md:flex">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground">{t('plugins.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('plugins.subtitle')}</p>
        </div>
        {tab === 'mcp' && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => void reload()}>
              <RefreshCw className="size-3.5" />
              {t('common.refresh')}
            </Button>
            <Button size="sm" className="h-8 gap-1" onClick={requestMcpDialog}>
              <Plus className="size-3.5" />
              {t('plugins.mcpAdd')}
            </Button>
          </div>
        )}
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

/** JSON 添加模式的归一化 server 定义（与 createMcpServer 的 def 对齐） */
interface ParsedMcpDef {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/** 归一化单个 server 定义：原生格式（含 name/transport）或 map 值（name 取 key） */
function normalizeMcpDef(value: unknown, nameFromKey?: string): ParsedMcpDef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const name =
    typeof v.name === 'string' && v.name.trim() ? v.name.trim() : (nameFromKey ?? '').trim();
  if (!name) return null;
  const hasCommand = typeof v.command === 'string' && v.command.trim().length > 0;
  const hasUrl = typeof v.url === 'string' && v.url.trim().length > 0;
  const transport: 'stdio' | 'http' | 'sse' | null =
    v.transport === 'stdio' || v.transport === 'http' || v.transport === 'sse'
      ? v.transport
      : hasCommand
        ? 'stdio'
        : hasUrl
          ? 'http'
          : null;
  if (!transport) return null;
  if (transport === 'stdio' && !hasCommand) return null;
  if (transport !== 'stdio' && !hasUrl) return null;

  const def: ParsedMcpDef = { name, transport };
  if (hasCommand) def.command = (v.command as string).trim();
  if (Array.isArray(v.args)) {
    const args = v.args.filter((a): a is string => typeof a === 'string');
    if (args.length > 0) def.args = args;
  }
  if (v.env && typeof v.env === 'object' && !Array.isArray(v.env)) {
    const env: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.env as Record<string, unknown>)) {
      if (typeof val === 'string') env[k] = val;
    }
    if (Object.keys(env).length > 0) def.env = env;
  }
  if (hasUrl) def.url = (v.url as string).trim();
  if (v.headers && typeof v.headers === 'object' && !Array.isArray(v.headers)) {
    const headers: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.headers as Record<string, unknown>)) {
      if (typeof val === 'string') headers[k] = val;
    }
    if (Object.keys(headers).length > 0) def.headers = headers;
  }
  return def;
}

/**
 * 解析 JSON 粘贴内容，支持三种主流格式：
 * 1. 单个原生定义：{ "name": "x", "transport": "stdio", "command": "npx", "args": [...] }
 * 2. Claude Desktop / Cursor 风格 map：{ "x": { "command": "npx", "args": [...] } }
 * 3. 以上两者的数组（批量添加）
 */
function parseMcpJsonInput(raw: string): ParsedMcpDef[] {
  const parsed: unknown = JSON.parse(raw);
  const defs: ParsedMcpDef[] = [];
  const push = (d: ParsedMcpDef | null): void => {
    if (d) defs.push(d);
  };
  if (Array.isArray(parsed)) {
    for (const item of parsed) push(normalizeMcpDef(item));
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj.name === 'string' ||
      typeof obj.transport === 'string' ||
      typeof obj.command === 'string' ||
      typeof obj.url === 'string'
    ) {
      push(normalizeMcpDef(obj));
    } else {
      for (const [key, val] of Object.entries(obj)) push(normalizeMcpDef(val, key));
    }
  }
  return defs;
}

/**
 * MOSS 自身 MCP 服务器（/mcp 端点）置顶卡片：
 * 开关（PUT /api/config 热更新）+ 端点预览 + 复制 JSON（主流 Agent 的 mcpServers 片段）。
 */
function MossServerCard() {
  const { t } = useTranslation();
  const appConfig = useStore((s) => s.appConfig);
  const enabledToolCount = useStore((s) => s.tools.filter((tl) => tl.enabled).length);
  const enabled = appConfig?.mcpServer?.enabled === true;
  const port = appConfig?.server?.port ?? 7766;
  const host =
    appConfig?.security?.bindLocalhostOnly === false ? window.location.hostname : '127.0.0.1';
  const endpoint = `http://${host}:${port}/mcp`;
  const [toggling, setToggling] = useState(false);

  const toggle = useCallback(
    async (on: boolean): Promise<void> => {
      setToggling(true);
      try {
        await api.updateAppConfig({
          mcpServer: { enabled: on, allowedTools: appConfig?.mcpServer?.allowedTools ?? [] },
        });
        toast.success(on ? t('plugins.mossServerEnabled') : t('plugins.mossServerDisabled'));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('plugins.mcpToggleFailed'));
      } finally {
        setToggling(false);
      }
    },
    [appConfig, t],
  );

  const copyJson = useCallback(async (): Promise<void> => {
    const token = appConfig?.security?.authToken ?? '';
    const snippet = {
      moss: {
        type: 'http',
        url: endpoint,
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      },
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(snippet, null, 2));
      toast.success(
        token
          ? `${t('plugins.mossServerJsonCopied')}（${t('plugins.mossServerTokenHint')}）`
          : t('plugins.mossServerJsonCopied'),
      );
    } catch {
      toast.error(t('plugins.mossServerCopyFailed'));
    }
  }, [appConfig, endpoint, t]);

  return (
    <Card className="flex flex-col gap-2 border-primary-strong/30 p-3">
      <div className="flex flex-row items-center gap-3">
        <div className="relative flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-strong/10 text-primary-strong">
          <Server className="size-5" />
          <span
            className={enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'}
            title={enabled ? t('plugins.mcpStatusConnected') : t('plugins.mcpStatusDisconnected')}
            aria-label={enabled ? t('plugins.mcpStatusConnected') : t('plugins.mcpStatusDisconnected')}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-foreground">{t('plugins.mossServerTitle')}</h3>
            <Badge variant="outline" className="font-normal">http</Badge>
            <Badge variant="secondary" className="font-normal">
              {t('plugins.mcpToolCount', { count: enabledToolCount })}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground" title={endpoint}>{endpoint}</p>
          <p className="truncate text-xs text-muted-foreground">{t('plugins.mossServerDesc')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost" size="icon-sm" title={t('plugins.mossServerCopyJson')}
            onClick={() => void copyJson()}
          >
            <Copy className="size-4" />
          </Button>
          <Switch
            checked={enabled}
            disabled={toggling}
            onCheckedChange={(checked) => void toggle(checked)}
            aria-label={enabled ? t('common.close') : t('common.open')}
          />
        </div>
      </div>
    </Card>
  );
}

export function McpTab() {
  const { t } = useTranslation();
  const { query } = useOutletContext<PluginOutletContext>();
  const { servers, tools, reload, connect, disconnect, remove, setEnabled } = useMcp();

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<McpServerForm>(EMPTY_MCP_FORM);
  const [saving, setSaving] = useState(false);
  // 添加模式：表单 / JSON 粘贴
  const [addMode, setAddMode] = useState<'form' | 'json'>('form');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // 删除确认弹窗（替代原生 confirm）
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 页面头部/移动端全局 header 按钮信号
  const mcpDialogRequest = useStore((s) => s.mcpDialogRequest);
  const clearMcpDialogRequest = useStore((s) => s.clearMcpDialogRequest);
  const mcpRefreshSeq = useStore((s) => s.mcpRefreshSeq);

  // header"添加服务器"按钮 → 打开添加弹窗
  useEffect(() => {
    if (mcpDialogRequest) {
      clearMcpDialogRequest();
      setAddOpen(true);
    }
  }, [mcpDialogRequest, clearMcpDialogRequest]);

  // 移动端全局 header 刷新按钮
  useEffect(() => {
    if (mcpRefreshSeq > 0) void reload();
  }, [mcpRefreshSeq, reload]);

  const q = query.trim().toLowerCase();
  const filteredServers = q
    ? servers.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.command ?? '').toLowerCase().includes(q) ||
          (s.url ?? '').toLowerCase().includes(q),
      )
    : servers;

  const submitForm = useCallback(async () => {
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

  const submitJson = useCallback(async () => {
    if (saving || !jsonText.trim()) return;
    setSaving(true);
    setJsonError(null);
    let defs: ParsedMcpDef[];
    try {
      defs = parseMcpJsonInput(jsonText);
    } catch {
      setJsonError(t('plugins.mcpJsonInvalid'));
      setSaving(false);
      return;
    }
    if (defs.length === 0) {
      setJsonError(t('plugins.mcpJsonInvalid'));
      setSaving(false);
      return;
    }
    let okCount = 0;
    const failures: string[] = [];
    for (const def of defs) {
      try {
        await api.createMcpServer(def);
        okCount++;
      } catch (err) {
        failures.push(`${def.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (okCount > 0) {
      toast.success(t('plugins.mcpCreatedMulti', { count: okCount }));
      setAddOpen(false);
      setJsonText('');
      void reload();
    }
    if (failures.length > 0) {
      toast.error(t('plugins.mcpCreateFailedMulti', { failures: failures.join('; ') }));
    }
    setSaving(false);
  }, [jsonText, saving, t, reload]);

  const submit = useCallback(async () => {
    if (addMode === 'json') {
      await submitJson();
    } else {
      await submitForm();
    }
  }, [addMode, submitForm, submitJson]);

  const statusColor = (s: McpServer['status']): string =>
    s === 'connected' ? 'bg-emerald-500' : s === 'error' ? 'bg-red-500' : 'bg-muted-foreground/40';

  return (
    <div className="p-6">
      <div className="flex flex-col gap-2">
        {/* MOSS 自身 MCP 服务器（/mcp 端点）置顶卡片：开关 / 端点预览 / 复制 JSON */}
        <MossServerCard />
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
                    onClick={() => setDeleteTarget(server.name)}
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

      {/* 删除服务器确认弹窗 */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('common.confirmDelete')}
        description={t('plugins.mcpDeleteConfirm', { name: deleteTarget ?? '' })}
        destructive
        loading={deleting}
        onConfirm={() => {
          if (!deleteTarget) return;
          const name = deleteTarget;
          setDeleting(true);
          void remove(name)
            .catch((err: unknown) =>
              toast.error(err instanceof Error ? err.message : t('plugins.mcpDeleteFailed')),
            )
            .finally(() => {
              setDeleting(false);
              setDeleteTarget(null);
            });
        }}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      />

      {/* 添加服务器弹窗 */}
      <Dialog open={addOpen} onOpenChange={(o) => !saving && setAddOpen(o)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t('plugins.mcpAdd')}</DialogTitle>
            <DialogDescription>{t('plugins.mcpAddDesc')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Tabs
              value={addMode}
              onValueChange={(v) => {
                setAddMode(v as 'form' | 'json');
                setJsonError(null);
              }}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="form">{t('plugins.mcpAddModeForm')}</TabsTrigger>
                <TabsTrigger value="json">{t('plugins.mcpAddModeJson')}</TabsTrigger>
              </TabsList>
            </Tabs>
            {addMode === 'form' && (
              <>
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
              </>
            )}
            {addMode === 'json' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-json">{t('plugins.mcpJsonLabel')}</Label>
                <Textarea
                  id="mcp-json"
                  value={jsonText}
                  spellCheck={false}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    setJsonError(null);
                  }}
                  placeholder={'{\n  "github": {\n    "command": "npx",\n    "args": ["-y", "@modelcontextprotocol/server-github"]\n  }\n}'}
                  className="min-h-40 font-mono text-xs"
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">{t('plugins.mcpJsonHint')}</p>
                {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={
                saving ||
                (addMode === 'form'
                  ? !form.name.trim() || (form.transport === 'stdio' ? !form.command.trim() : !form.url.trim())
                  : !jsonText.trim())
              }
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
