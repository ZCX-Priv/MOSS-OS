import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Settings,
  Bot,
  Brain,
  Activity,
  Globe,
  Notebook,
  Palette,
  ClipboardList,
  Webhook,
  Info,
  ChevronDown,
  ChevronRight,
  Check,
  Sun,
  Moon,
  Monitor,
  Plus,
  Book,
  ExternalLink,
  Database,
  Terminal,
  Layers,
  Trash2,
  GripVertical,
  Loader2,
  Search,
  Wrench,
  FileCode,
  Pencil,
  ShieldCheck,
  ScrollText,
  RefreshCw,
  Eye,
  Sparkles,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SettingsSection } from '../../types';
import { useTheme } from '../../contexts/ThemeContext';
import { useLocale } from '../../hooks/useLocale';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useModels } from '../../hooks/useModels';
import { useAgents } from '../../hooks/useAgents';
import { useTools } from '../../hooks/useTools';
import { useSpecs } from '../../hooks/useSpecs';
import { useConfig } from '../../hooks/useConfig';
import { useReducedMotion } from '../../hooks/useAnimationClass';
import { useStore } from '../../store';
import { api } from '../../api/http';
import { TOOL_ICON_MAP } from '../../lib/tool-icons';
import { parseLegacyWindow, toEffortLevel } from '../../lib/model-utils';
import type { ModelItem, SpecDetail, SafetyConfig, LogLevel, LogsConfig, LogFileInfo, ContextEngineConfig } from '../../types/api';

export interface NavItem {
  id: SettingsSection;
  labelKey: string;
  Icon: LucideIcon;
}

export const settingsNavItems: NavItem[] = [
  { id: 'general', labelKey: 'settings.nav.general', Icon: Settings },
  { id: 'appearance', labelKey: 'settings.nav.appearance', Icon: Palette },
  { id: 'agent', labelKey: 'settings.nav.agent', Icon: Bot },
  { id: 'model', labelKey: 'settings.nav.model', Icon: Brain },
  { id: 'context', labelKey: 'settings.nav.context', Icon: Database },
  { id: 'tools', labelKey: 'settings.nav.tools', Icon: Wrench },
  { id: 'safety', labelKey: 'settings.nav.safety', Icon: ShieldCheck },
  { id: 'logs', labelKey: 'settings.nav.logs', Icon: ScrollText },
  { id: 'commands', labelKey: 'settings.nav.commands', Icon: Terminal },
  { id: 'hooks', labelKey: 'settings.nav.hooks', Icon: Webhook },
  { id: 'about', labelKey: 'settings.nav.about', Icon: Info },
];

export interface SearchableSetting {
  labelKey: string;
  descriptionKey?: string;
  section: SettingsSection;
}

export const settingsSearchIndex: SearchableSetting[] = [
  // 页面级（导航项 + placeholder 页面描述）
  { labelKey: 'settings.nav.general', section: 'general' },
  { labelKey: 'settings.nav.appearance', section: 'appearance' },
  { labelKey: 'settings.nav.render', section: 'render' },
  { labelKey: 'settings.render.markdown', descriptionKey: 'settings.render.markdownDesc', section: 'render' },
  { labelKey: 'settings.render.math', descriptionKey: 'settings.render.mathDesc', section: 'render' },
  { labelKey: 'settings.render.mathFallback', descriptionKey: 'settings.render.mathFallbackDesc', section: 'render' },
  { labelKey: 'settings.render.mermaid', descriptionKey: 'settings.render.mermaidDesc', section: 'render' },
  { labelKey: 'settings.render.codeHighlight', descriptionKey: 'settings.render.codeHighlightDesc', section: 'render' },
  { labelKey: 'settings.render.filePreview', descriptionKey: 'settings.render.filePreviewDesc', section: 'render' },
  { labelKey: 'settings.nav.anim', section: 'anim' },
  { labelKey: 'settings.anim.master', descriptionKey: 'settings.anim.masterDesc', section: 'anim' },
  { labelKey: 'settings.anim.route', descriptionKey: 'settings.anim.routeDesc', section: 'anim' },
  { labelKey: 'settings.anim.message', descriptionKey: 'settings.anim.messageDesc', section: 'anim' },
  { labelKey: 'settings.anim.list', descriptionKey: 'settings.anim.listDesc', section: 'anim' },
  { labelKey: 'settings.anim.stat', descriptionKey: 'settings.anim.statDesc', section: 'anim' },
  { labelKey: 'settings.anim.hub', descriptionKey: 'settings.anim.hubDesc', section: 'anim' },
  { labelKey: 'settings.anim.panel', descriptionKey: 'settings.anim.panelDesc', section: 'anim' },
  { labelKey: 'settings.nav.agent', section: 'agent' },
  { labelKey: 'settings.nav.model', section: 'model' },
  { labelKey: 'settings.nav.context', section: 'context' },
  { labelKey: 'settings.context.compactionTitle', descriptionKey: 'settings.context.compactionDesc', section: 'context' },
  { labelKey: 'settings.context.summaryModel', descriptionKey: 'settings.context.summaryModelDesc', section: 'context' },
  { labelKey: 'settings.context.healerTitle', descriptionKey: 'settings.context.healerDesc', section: 'context' },
  { labelKey: 'settings.nav.tools', section: 'tools' },
  { labelKey: 'settings.tools.maxTurnsLabel', descriptionKey: 'settings.tools.maxTurnsDesc', section: 'tools' },
  { labelKey: 'settings.nav.specs', section: 'specs' },
  { labelKey: 'settings.nav.safety', section: 'safety' },
  { labelKey: 'settings.nav.logs', section: 'logs' },
  { labelKey: 'settings.safety.defaultMode', descriptionKey: 'settings.safety.defaultModeDesc', section: 'safety' },
  { labelKey: 'settings.safety.confirmTimeout', descriptionKey: 'settings.safety.confirmTimeoutDesc', section: 'safety' },
  { labelKey: 'settings.safety.sandboxTitle', descriptionKey: 'settings.safety.sandboxDesc', section: 'safety' },
  { labelKey: 'settings.safety.rulesTitle', descriptionKey: 'settings.safety.rulesDesc', section: 'safety' },
  { labelKey: 'settings.placeholder.indexTitle', descriptionKey: 'settings.placeholder.indexDesc', section: 'index' },
  { labelKey: 'settings.placeholder.commandsTitle', descriptionKey: 'settings.placeholder.commandsDesc', section: 'commands' },
  { labelKey: 'settings.placeholder.rulesTitle', descriptionKey: 'settings.placeholder.rulesDesc', section: 'rules' },
  { labelKey: 'settings.placeholder.memoryTitle', descriptionKey: 'settings.placeholder.memoryDesc', section: 'memory' },
  { labelKey: 'settings.placeholder.hooksTitle', descriptionKey: 'settings.placeholder.hooksDesc', section: 'hooks' },
  { labelKey: 'settings.nav.about', section: 'about' },

  // 通用设置详细项
  { labelKey: 'settings.general.theme', descriptionKey: 'settings.general.selectTheme', section: 'general' },
  { labelKey: 'settings.general.language', descriptionKey: 'settings.general.languageDesc', section: 'general' },
  { labelKey: 'settings.general.sendShortcut', descriptionKey: 'settings.general.sendShortcutDesc', section: 'general' },
  { labelKey: 'settings.general.editorSettings', descriptionKey: 'settings.general.editorSettingsDesc', section: 'general' },
  { labelKey: 'settings.general.shortcutSettings', descriptionKey: 'settings.general.shortcutSettingsDesc', section: 'general' },
  { labelKey: 'settings.general.importConfig', descriptionKey: 'settings.general.importConfigDesc', section: 'general' },
  { labelKey: 'settings.general.localLink', descriptionKey: 'settings.general.localLinkDesc', section: 'general' },
  { labelKey: 'settings.general.markdownOpen', descriptionKey: 'settings.general.markdownOpenDesc', section: 'general' },

  // 智能体设置详细项
  { labelKey: 'settings.agent.builtIn', section: 'agent' },
  { labelKey: 'settings.agent.custom', section: 'agent' },
  { labelKey: 'settings.agent.createAgent', section: 'agent' },

  // 模型设置详细项
  { labelKey: 'settings.model.addModel', section: 'model' },
  { labelKey: 'settings.model.contextWindow', section: 'model' },
  { labelKey: 'settings.model.thinkingMode', descriptionKey: 'settings.model.thinkingModeDesc', section: 'model' },
  { labelKey: 'settings.model.displayName', section: 'model' },
  { labelKey: 'settings.model.modelName', section: 'model' },
  { labelKey: 'settings.model.apiFormat', section: 'model' },
  { labelKey: 'settings.model.endpoint', section: 'model' },
  { labelKey: 'settings.model.apiKey', section: 'model' },
  { labelKey: 'settings.model.thinkingLevel', descriptionKey: 'settings.model.thinkingModeDesc', section: 'model' },

  // 关于设置详细项
  { labelKey: 'settings.about.relatedLinks', section: 'about' },
  { labelKey: 'settings.about.docs', section: 'about' },
];

export function SettingsPage() {
  const { pathname } = useLocation();
  return (
    <section
      key={pathname}
      className="anim-route animate-in fade-in slide-in-from-bottom-1 duration-200 flex-1 overflow-auto"
    >
      <Outlet />
    </section>
  );
}

/** 外观设置：Tab 容器（外观/渲染/动画；路由驱动） */
export function AppearanceSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const tab = pathname.startsWith('/settings/appearance/render')
    ? 'render'
    : pathname.startsWith('/settings/appearance/anim')
      ? 'anim'
      : 'appearance';
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-6 py-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground">{t('settings.nav.appearance')}</h1>
          <p className="text-sm text-muted-foreground">{t('settings.appearance.subtitle')}</p>
        </div>
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) =>
          navigate(
            v === 'appearance'
              ? '/settings/appearance'
              : v === 'render'
                ? '/settings/appearance/render'
                : '/settings/appearance/anim',
          )
        }
      >
        <div className="px-6 py-3">
          <TabsList>
            <TabsTrigger value="appearance" className="gap-1.5">
              <Palette className="size-3.5" />
              {t('settings.nav.appearance')}
            </TabsTrigger>
            <TabsTrigger value="render" className="gap-1.5">
              <Eye className="size-3.5" />
              {t('settings.nav.render')}
            </TabsTrigger>
            <TabsTrigger value="anim" className="gap-1.5">
              <Sparkles className="size-3.5" />
              {t('settings.nav.anim')}
            </TabsTrigger>
          </TabsList>
        </div>
      </Tabs>
      {/* 分区切换入场动画（key=pathname：Tab 切换时重播） */}
      <div
        key={pathname}
        className="anim-route animate-in fade-in slide-in-from-bottom-1 duration-200 flex-1 overflow-auto"
      >
        <Outlet />
      </div>
    </div>
  );
}

/* ===== 渲染设置（render 模块：markdown/公式/图表/高亮/文件预览） ===== */

/** 通用设置行（与 GeneralSettings 行结构对齐：divide-y 分隔 + py-3；children 渲染在描述下方） */
function SettingRow({
  title,
  desc,
  checked,
  disabled,
  onCheckedChange,
  children,
}: {
  title: string;
  desc?: string;
  checked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-foreground">{title}</span>
        {desc && <span className="text-xs text-muted-foreground">{desc}</span>}
        {children}
      </div>
      {onCheckedChange && (
        <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
      )}
    </div>
  );
}

export function RenderSettingsSection() {
  const { t } = useTranslation();
  const renderSettings = useStore((s) => s.renderSettings);
  const setRenderSetting = useStore((s) => s.setRenderSetting);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3">
        <div className="text-sm font-medium text-foreground">{t('settings.render.contentTitle')}</div>
        <div className="flex flex-col divide-y divide-border">
          <SettingRow
            title={t('settings.render.markdown')}
            desc={t('settings.render.markdownDesc')}
            checked={renderSettings.markdownEnabled}
            onCheckedChange={(v) => setRenderSetting('markdownEnabled', v)}
          />
          <SettingRow
            title={t('settings.render.math')}
            desc={t('settings.render.mathDesc')}
            checked={renderSettings.mathEnabled}
            onCheckedChange={(v) => setRenderSetting('mathEnabled', v)}
          />
          <SettingRow
            title={t('settings.render.mathFallback')}
            desc={t('settings.render.mathFallbackDesc')}
            checked={renderSettings.mathFallback}
            disabled={!renderSettings.mathEnabled}
            onCheckedChange={(v) => setRenderSetting('mathFallback', v)}
          />
          <SettingRow
            title={t('settings.render.mermaid')}
            desc={t('settings.render.mermaidDesc')}
            checked={renderSettings.mermaidEnabled}
            onCheckedChange={(v) => setRenderSetting('mermaidEnabled', v)}
          />
          <SettingRow
            title={t('settings.render.codeHighlight')}
            desc={t('settings.render.codeHighlightDesc')}
            checked={renderSettings.codeHighlightEnabled}
            onCheckedChange={(v) => setRenderSetting('codeHighlightEnabled', v)}
          />
          <SettingRow
            title={t('settings.render.filePreview')}
            desc={t('settings.render.filePreviewDesc')}
            checked={renderSettings.filePreviewEnabled}
            onCheckedChange={(v) => setRenderSetting('filePreviewEnabled', v)}
          />
        </div>
      </div>
    </div>
  );
}

/* ===== 动画设置（外观页「动画」Tab：总开关 + 分开关 + 系统减弱动态联动） ===== */

export function AnimSettingsSection() {
  const { t } = useTranslation();
  const animationSettings = useStore((s) => s.animationSettings);
  const setAnimationSetting = useStore((s) => s.setAnimationSetting);
  // 系统开启"减弱动态效果"：全部动画强制停用，开关禁用并显示为关（实时生效）
  const reduced = useReducedMotion();
  const masterOff = !animationSettings.enabled;
  const catDisabled = reduced || masterOff;
  const catChecked = (v: boolean) => v && !catDisabled;

  return (
    <div className="flex flex-col gap-6 p-6">
      {reduced && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t('settings.anim.reducedMotionNotice')}
        </div>
      )}
      <div className="flex flex-col gap-3">
        <div className="text-sm font-medium text-foreground">{t('settings.anim.groupTitle')}</div>
        <div className="flex flex-col divide-y divide-border">
          <SettingRow
            title={t('settings.anim.master')}
            desc={t('settings.anim.masterDesc')}
            checked={animationSettings.enabled && !reduced}
            disabled={reduced}
            onCheckedChange={(v) => setAnimationSetting('enabled', v)}
          />
          <SettingRow
            title={t('settings.anim.route')}
            desc={t('settings.anim.routeDesc')}
            checked={catChecked(animationSettings.route)}
            disabled={catDisabled}
            onCheckedChange={(v) => setAnimationSetting('route', v)}
          />
          <SettingRow
            title={t('settings.anim.message')}
            desc={t('settings.anim.messageDesc')}
            checked={catChecked(animationSettings.message)}
            disabled={catDisabled}
            onCheckedChange={(v) => setAnimationSetting('message', v)}
          />
          <SettingRow
            title={t('settings.anim.list')}
            desc={t('settings.anim.listDesc')}
            checked={catChecked(animationSettings.list)}
            disabled={catDisabled}
            onCheckedChange={(v) => setAnimationSetting('list', v)}
          />
          <SettingRow
            title={t('settings.anim.stat')}
            desc={t('settings.anim.statDesc')}
            checked={catChecked(animationSettings.stat)}
            disabled={catDisabled}
            onCheckedChange={(v) => setAnimationSetting('stat', v)}
          />
          <SettingRow
            title={t('settings.anim.hub')}
            desc={t('settings.anim.hubDesc')}
            checked={catChecked(animationSettings.hub)}
            disabled={catDisabled}
            onCheckedChange={(v) => setAnimationSetting('hub', v)}
          />
          <SettingRow
            title={t('settings.anim.panel')}
            desc={t('settings.anim.panelDesc')}
            checked={catChecked(animationSettings.panel)}
            disabled={catDisabled}
            onCheckedChange={(v) => setAnimationSetting('panel', v)}
          />
        </div>
      </div>
    </div>
  );
}

/* ===== 安全设置（safety 统一权限系统） ===== */

/** 安全设置默认值（后端 config 缺 safety 段时的展示兜底） */
const SAFETY_FALLBACK: SafetyConfig = {
  defaultMode: 'ask',
  confirmTimeoutMinutes: 5,
  blockDangerousCommands: true,
  cautionPolicy: 'ask',
  rules: { allow: [], deny: [], ask: [] },
  protectedPaths: ['~/.ssh', '~/.gnupg', '~/.aws'],
};

/** 规则列表编辑器（allow/deny/ask 同构） */
function SafetyRuleList({
  titleKey,
  descKey,
  rules,
  onAdd,
  onRemove,
  accentClass,
}: {
  titleKey: string;
  descKey: string;
  rules: string[];
  onAdd: (rule: string) => void;
  onRemove: (rule: string) => void;
  accentClass: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (rules.includes(trimmed)) {
      toast.error(t('settings.safety.ruleDuplicate'));
      return;
    }
    onAdd(trimmed);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-2">
        <span className={cn('size-2 shrink-0 rounded-full', accentClass)} />
        <span className="text-sm font-medium text-foreground">{t(titleKey)}</span>
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground">
          {rules.length}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{t(descKey)}</p>
      {rules.length > 0 && (
        <div className="flex flex-col gap-1">
          {rules.map((rule) => (
            <div
              key={rule}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-2 py-1"
            >
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{rule}</code>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => onRemove(rule)}
                title={t('common.delete')}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="shell(git *)"
          className="h-8 flex-1 font-mono text-xs"
        />
        <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1" onClick={add} disabled={!draft.trim()}>
          <Plus className="size-3.5" />
          <span className="hidden sm:inline">{t('settings.safety.addRule')}</span>
        </Button>
      </div>
    </div>
  );
}

export function SafetySettings() {
  const { t } = useTranslation();
  const { appConfig, updateAppConfig } = useConfig();
  const [pathDraft, setPathDraft] = useState('');
  const safety = appConfig?.safety ?? SAFETY_FALLBACK;

  const patchSafety = async (patch: Partial<typeof SAFETY_FALLBACK>) => {
    try {
      await updateAppConfig({ safety: { ...safety, ...patch } });
    } catch {
      // toast 已在 useConfig 内处理
    }
  };

  const patchRules = (list: 'allow' | 'deny' | 'ask', mutate: (rules: string[]) => string[]) => {
    void patchSafety({ rules: { ...safety.rules, [list]: mutate([...safety.rules[list]]) } });
  };

  const addProtectedPath = () => {
    const trimmed = pathDraft.trim();
    if (!trimmed) return;
    if (safety.protectedPaths.includes(trimmed)) return;
    void patchSafety({ protectedPaths: [...safety.protectedPaths, trimmed] });
    setPathDraft('');
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">{t('settings.safety.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.safety.subtitle')}</p>
      </div>

      {/* 权限模式 */}
      <div className="flex flex-col gap-3">
        <div className="text-sm font-medium text-foreground">{t('settings.safety.modeTitle')}</div>
        <div className="flex flex-col divide-y divide-border">
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm text-foreground">{t('settings.safety.defaultMode')}</span>
              <span className="text-xs text-muted-foreground">{t('settings.safety.defaultModeDesc')}</span>
            </div>
            <Select
              value={safety.defaultMode}
              onValueChange={(v) => void patchSafety({ defaultMode: v as typeof safety.defaultMode })}
            >
              <SelectTrigger className="h-8 w-40 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                <SelectItem value="ask">{t('permissionMode.ask.label')}</SelectItem>
                <SelectItem value="auto">{t('permissionMode.auto.label')}</SelectItem>
                <SelectItem value="skip">{t('permissionMode.skip.label')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm text-foreground">{t('settings.safety.confirmTimeout')}</span>
              <span className="text-xs text-muted-foreground">{t('settings.safety.confirmTimeoutDesc')}</span>
            </div>
            <Input
              type="number"
              min={0}
              max={1440}
              value={safety.confirmTimeoutMinutes}
              onChange={(e) => {
                const v = Math.max(0, Math.min(1440, Number(e.target.value) || 0));
                void patchSafety({ confirmTimeoutMinutes: v });
              }}
              className="h-8 w-24 shrink-0 text-right"
            />
          </div>
        </div>
      </div>

      {/* 沙箱（智能拦截） */}
      <div className="flex flex-col gap-3">
        <div className="text-sm font-medium text-foreground">{t('settings.safety.sandboxTitle')}</div>
        <p className="text-xs text-muted-foreground">{t('settings.safety.sandboxDesc')}</p>
        <div className="flex flex-col divide-y divide-border">
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm text-foreground">{t('settings.safety.blockDangerous')}</span>
              <span className="text-xs text-muted-foreground">{t('settings.safety.blockDangerousDesc')}</span>
            </div>
            <Switch
              checked={safety.blockDangerousCommands}
              onCheckedChange={(v) => void patchSafety({ blockDangerousCommands: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm text-foreground">{t('settings.safety.cautionPolicy')}</span>
              <span className="text-xs text-muted-foreground">{t('settings.safety.cautionPolicyDesc')}</span>
            </div>
            <Select
              value={safety.cautionPolicy}
              onValueChange={(v) => void patchSafety({ cautionPolicy: v as typeof safety.cautionPolicy })}
            >
              <SelectTrigger className="h-8 w-32 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                <SelectItem value="ask">{t('settings.safety.cautionAsk')}</SelectItem>
                <SelectItem value="deny">{t('settings.safety.cautionDeny')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2 py-3">
            <span className="text-sm text-foreground">{t('settings.safety.protectedPaths')}</span>
            <span className="text-xs text-muted-foreground">{t('settings.safety.protectedPathsDesc')}</span>
            {safety.protectedPaths.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {safety.protectedPaths.map((p) => (
                  <Badge key={p} variant="secondary" className="gap-1 py-0.5 pl-2 pr-1 font-mono text-[11px]">
                    {p}
                    <button
                      className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                      onClick={() =>
                        void patchSafety({ protectedPaths: safety.protectedPaths.filter((x) => x !== p) })
                      }
                      title={t('common.delete')}
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={pathDraft}
                onChange={(e) => setPathDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addProtectedPath();
                  }
                }}
                placeholder="~/.ssh"
                className="h-8 flex-1 font-mono text-xs"
              />
              <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1" onClick={addProtectedPath} disabled={!pathDraft.trim()}>
                <Plus className="size-3.5" />
              </Button>
            </div>
            {/* 硬保护只读展示 */}
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/20 px-2 py-1">
              <ShieldCheck className="size-3 shrink-0 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">
                {t('settings.safety.hardProtected')}
                <code className="mx-1 font-mono">~/.moss/config</code>
                {t('settings.safety.hardProtectedDesc')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 规则表 */}
      <div className="flex flex-col gap-3">
        <div className="text-sm font-medium text-foreground">{t('settings.safety.rulesTitle')}</div>
        <p className="text-xs text-muted-foreground">{t('settings.safety.rulesDesc')}</p>
        <details className="rounded-md border border-border bg-muted/20 px-2 py-1.5">
          <summary className="cursor-pointer select-none text-xs text-muted-foreground">
            {t('settings.safety.syntaxHelp')}
          </summary>
          <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-foreground">
            {t('settings.safety.syntaxExamples')}
          </pre>
        </details>
        <div className="flex flex-col divide-y divide-border">
          <SafetyRuleList
            titleKey="settings.safety.denyRules"
            descKey="settings.safety.denyRulesDesc"
            rules={safety.rules.deny}
            onAdd={(rule) => patchRules('deny', (r) => [...r, rule])}
            onRemove={(rule) => patchRules('deny', (r) => r.filter((x) => x !== rule))}
            accentClass="bg-red-500"
          />
          <SafetyRuleList
            titleKey="settings.safety.askRules"
            descKey="settings.safety.askRulesDesc"
            rules={safety.rules.ask}
            onAdd={(rule) => patchRules('ask', (r) => [...r, rule])}
            onRemove={(rule) => patchRules('ask', (r) => r.filter((x) => x !== rule))}
            accentClass="bg-amber-500"
          />
          <SafetyRuleList
            titleKey="settings.safety.allowRules"
            descKey="settings.safety.allowRulesDesc"
            rules={safety.rules.allow}
            onAdd={(rule) => patchRules('allow', (r) => [...r, rule])}
            onRemove={(rule) => patchRules('allow', (r) => r.filter((x) => x !== rule))}
            accentClass="bg-emerald-500"
          />
        </div>
      </div>
    </div>
  );
}

/* ===== 上下文引擎设置（压缩 / 摘要模型 / 工具结果修剪 / 自愈） ===== */

const CONTEXT_FALLBACK: ContextEngineConfig = {
  compaction: {
    enabled: true,
    compactRatio: 0.8,
    tailKeepRatio: 0.16,
    summaryMaxTokens: 8192,
    minFoldTokens: 400,
    summaryModel: 'inherit',
  },
  toolPruning: { enabled: true, thresholdChars: 8192, keepHeadChars: 4096, keepTailChars: 1024 },
  healer: { enabled: true, toolNameFuzzy: true, schemaFix: true },
  telemetry: { enabled: true },
};

/** 上下文引擎设置行（标题 + 描述 + 控件；复用 safety/render 的行样式） */
function ContextSettingRow({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border/60 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {desc ? <span className="text-xs text-muted-foreground">{desc}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** 上下文设置：Tab 容器（引擎/规范/索引/规则/记忆；路由驱动） */
export function ContextSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const suffix = pathname.startsWith('/settings/context/')
    ? pathname.slice('/settings/context/'.length)
    : '';
  const tab = ['specs', 'index', 'rules', 'memory'].includes(suffix)
    ? suffix
    : 'engine';
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-6 py-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground">{t('settings.nav.context')}</h1>
          <p className="text-sm text-muted-foreground">{t('settings.context.subtitle')}</p>
        </div>
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) =>
          navigate(v === 'engine' ? '/settings/context' : `/settings/context/${v}`)
        }
      >
        <div className="px-6 py-3">
          <TabsList>
            <TabsTrigger value="engine" className="gap-1.5">
              <Activity className="size-3.5" />
              {t('settings.context.tabEngine')}
            </TabsTrigger>
            <TabsTrigger value="specs" className="gap-1.5">
              <FileCode className="size-3.5" />
              {t('settings.nav.specs')}
            </TabsTrigger>
            <TabsTrigger value="index" className="gap-1.5">
              <Layers className="size-3.5" />
              {t('settings.nav.index')}
            </TabsTrigger>
            <TabsTrigger value="rules" className="gap-1.5">
              <ClipboardList className="size-3.5" />
              {t('settings.nav.rules')}
            </TabsTrigger>
            <TabsTrigger value="memory" className="gap-1.5">
              <Notebook className="size-3.5" />
              {t('settings.nav.memory')}
            </TabsTrigger>
          </TabsList>
        </div>
      </Tabs>
      {/* 分区切换入场动画（key=pathname：Tab 切换时重播） */}
      <div
        key={pathname}
        className="anim-route animate-in fade-in slide-in-from-bottom-1 duration-200 flex-1 overflow-auto"
      >
        <Outlet />
      </div>
    </div>
  );
}

/** 引擎设置（上下文压缩 / 摘要模型 / 工具结果修剪 / 自愈） */
export function ContextEngineSettings() {
  const { t } = useTranslation();
  const { appConfig, apiConfig, updateAppConfig } = useConfig();
  const context = appConfig?.context ?? CONTEXT_FALLBACK;
  const models = apiConfig?.models ?? [];

  const patchContext = (patch: Partial<ContextEngineConfig>) => {
    void updateAppConfig({ context: { ...context, ...patch } }).catch(() => {
      // toast 已在 useConfig 内处理
    });
  };
  const patchCompaction = (patch: Partial<ContextEngineConfig['compaction']>) => {
    patchContext({ compaction: { ...context.compaction, ...patch } });
  };

  return (
    <div className="flex flex-col gap-6 p-6">

      {/* 上下文压缩 */}
      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium text-foreground">{t('settings.context.compactionTitle')}</div>
        <div className="text-xs text-muted-foreground">{t('settings.context.compactionDesc')}</div>
        <div className="mt-2 flex flex-col rounded-lg border border-border px-4">
          <ContextSettingRow
            title={t('settings.context.compactionEnabled')}
            desc={t('settings.context.compactionEnabledDesc')}
          >
            <Switch
              checked={context.compaction.enabled}
              onCheckedChange={(v) => patchCompaction({ enabled: v })}
            />
          </ContextSettingRow>
          <ContextSettingRow
            title={t('settings.context.compactRatio')}
            desc={t('settings.context.compactRatioDesc')}
          >
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0.5}
                max={0.95}
                step={0.05}
                value={context.compaction.compactRatio}
                onChange={(e) => patchCompaction({ compactRatio: Number(e.target.value) })}
                className="w-32"
                disabled={!context.compaction.enabled}
              />
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(context.compaction.compactRatio * 100)}%
              </span>
            </div>
          </ContextSettingRow>
          <ContextSettingRow
            title={t('settings.context.tailKeepRatio')}
            desc={t('settings.context.tailKeepRatioDesc')}
          >
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0.05}
                max={0.5}
                step={0.01}
                value={context.compaction.tailKeepRatio}
                onChange={(e) => patchCompaction({ tailKeepRatio: Number(e.target.value) })}
                className="w-32"
                disabled={!context.compaction.enabled}
              />
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(context.compaction.tailKeepRatio * 100)}%
              </span>
            </div>
          </ContextSettingRow>
          <ContextSettingRow
            title={t('settings.context.summaryMaxTokens')}
            desc={t('settings.context.summaryMaxTokensDesc')}
          >
            <Input
              type="number"
              min={512}
              max={32768}
              value={context.compaction.summaryMaxTokens}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 512 && v <= 32768) {
                  patchCompaction({ summaryMaxTokens: Math.round(v) });
                }
              }}
              className="w-28"
              disabled={!context.compaction.enabled}
            />
          </ContextSettingRow>
          <ContextSettingRow
            title={t('settings.context.summaryModel')}
            desc={t('settings.context.summaryModelDesc')}
          >
            <Select
              value={context.compaction.summaryModel}
              onValueChange={(v) => patchCompaction({ summaryModel: v })}
              disabled={!context.compaction.enabled}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">{t('settings.context.summaryModelInherit')}</SelectItem>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ContextSettingRow>
        </div>
      </div>

      {/* 工具结果修剪 */}
      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium text-foreground">{t('settings.context.toolPruningTitle')}</div>
        <div className="text-xs text-muted-foreground">{t('settings.context.toolPruningDesc')}</div>
        <div className="mt-2 flex flex-col rounded-lg border border-border px-4">
          <ContextSettingRow
            title={t('settings.context.toolPruningEnabled')}
            desc={t('settings.context.toolPruningEnabledDesc')}
          >
            <Switch
              checked={context.toolPruning.enabled}
              onCheckedChange={(v) => patchContext({ toolPruning: { ...context.toolPruning, enabled: v } })}
            />
          </ContextSettingRow>
        </div>
      </div>

      {/* 工具调用自愈 */}
      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium text-foreground">{t('settings.context.healerTitle')}</div>
        <div className="text-xs text-muted-foreground">{t('settings.context.healerDesc')}</div>
        <div className="mt-2 flex flex-col rounded-lg border border-border px-4">
          <ContextSettingRow
            title={t('settings.context.healerEnabled')}
            desc={t('settings.context.healerEnabledDesc')}
          >
            <Switch
              checked={context.healer.enabled}
              onCheckedChange={(v) => patchContext({ healer: { ...context.healer, enabled: v } })}
            />
          </ContextSettingRow>
          <ContextSettingRow
            title={t('settings.context.toolNameFuzzy')}
            desc={t('settings.context.toolNameFuzzyDesc')}
          >
            <Switch
              checked={context.healer.toolNameFuzzy}
              disabled={!context.healer.enabled}
              onCheckedChange={(v) => patchContext({ healer: { ...context.healer, toolNameFuzzy: v } })}
            />
          </ContextSettingRow>
          <ContextSettingRow
            title={t('settings.context.schemaFix')}
            desc={t('settings.context.schemaFixDesc')}
          >
            <Switch
              checked={context.healer.schemaFix}
              disabled={!context.healer.enabled}
              onCheckedChange={(v) => patchContext({ healer: { ...context.healer, schemaFix: v } })}
            />
          </ContextSettingRow>
        </div>
      </div>
    </div>
  );
}

/* ===== 日志设置 ===== */
const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];
const LOGS_FALLBACK: LogsConfig = { level: 'info', retentionDays: 14, maxFileMb: 10 };
const LOG_LINE_RE = /^(\S+)\s+(DEBUG|INFO|WARN|ERROR|FATAL)\s*\[([^\]]*)\]\s?(.*)$/;
const LEVEL_BADGE_CLASS: Record<string, string> = {
  DEBUG: 'bg-muted text-muted-foreground',
  INFO: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  WARN: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  ERROR: 'bg-red-500/15 text-red-600 dark:text-red-400',
  FATAL: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
};

export function LogsSettings() {
  const { t } = useTranslation();
  const { appConfig, updateAppConfig } = useConfig();
  const logs = appConfig?.logs ?? LOGS_FALLBACK;

  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [file, setFile] = useState('');
  const [minLevel, setMinLevel] = useState<'all' | LogLevel>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const PAGE = 200;

  const patchLogs = (p: Partial<LogsConfig>) => {
    void updateAppConfig({ logs: { ...logs, ...p } }).catch(() => {
      // toast 已在 useConfig 内处理
    });
  };

  const loadFiles = useCallback(async (autoPick: boolean) => {
    try {
      const resp = await api.listLogFiles();
      setFiles(resp.files);
      if (autoPick) {
        setFile((prev) =>
          prev && resp.files.some((f) => f.name === prev) ? prev : (resp.files[0]?.name ?? ''),
        );
      }
    } catch {
      // 后端未就绪静默
    }
  }, []);

  const query = useCallback(
    async (offset: number) => {
      setLoading(true);
      try {
        const resp = await api.queryLogs({
          file: file || undefined,
          minLevel: minLevel === 'all' ? undefined : minLevel,
          search: search || undefined,
          limit: PAGE,
          offset,
        });
        setLines((prev) => (offset === 0 ? resp.lines : [...prev, ...resp.lines]));
        setTotal(resp.total);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [file, minLevel, search],
  );

  useEffect(() => {
    void loadFiles(true);
  }, [loadFiles]);

  // 实时搜索：输入防抖 300ms 后自动应用查询（无需回车）
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // file / minLevel / search 变化时自动重查（offset=0）
  useEffect(() => {
    void query(0);
  }, [query]);

  const handleCleanup = async () => {
    try {
      const resp = await api.cleanupLogs();
      if (resp.removed > 0) {
        toast.success(t('settings.logs.cleanupDone', { count: resp.removed }));
      } else {
        toast.info(t('settings.logs.cleanupNone'));
      }
      void loadFiles(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const fmtSize = (n: number): string =>
    n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">{t('settings.logs.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.logs.subtitle')}</p>
      </div>

      {/* 日志配置 */}
      <div className="flex flex-col gap-3">
        <div className="text-sm font-medium text-foreground">{t('settings.logs.configTitle')}</div>
        <div className="flex flex-col divide-y divide-border">
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm text-foreground">{t('settings.logs.level')}</span>
              <span className="text-xs text-muted-foreground">{t('settings.logs.levelDesc')}</span>
            </div>
            <Select value={logs.level} onValueChange={(v) => patchLogs({ level: v as LogLevel })}>
              <SelectTrigger className="h-8 w-36 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                {LOG_LEVELS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm text-foreground">{t('settings.logs.retentionDays')}</span>
              <span className="text-xs text-muted-foreground">{t('settings.logs.retentionDaysDesc')}</span>
            </div>
            <Input
              type="number"
              min={1}
              max={365}
              value={logs.retentionDays}
              onChange={(e) => {
                const v = Math.max(1, Math.min(365, Number(e.target.value) || 1));
                patchLogs({ retentionDays: v });
              }}
              className="h-8 w-24 shrink-0 text-right"
            />
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm text-foreground">{t('settings.logs.maxFileMb')}</span>
              <span className="text-xs text-muted-foreground">{t('settings.logs.maxFileMbDesc')}</span>
            </div>
            <Input
              type="number"
              min={1}
              max={100}
              value={logs.maxFileMb}
              onChange={(e) => {
                const v = Math.max(1, Math.min(100, Number(e.target.value) || 1));
                patchLogs({ maxFileMb: v });
              }}
              className="h-8 w-24 shrink-0 text-right"
            />
          </div>
        </div>
      </div>

      {/* 日志查看 */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-foreground">{t('settings.logs.viewerTitle')}</div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={() => { void loadFiles(true); void query(0); }}>
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              {t('settings.logs.refresh')}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={() => void handleCleanup()}>
              <Trash2 className="h-3.5 w-3.5" />
              {t('settings.logs.cleanup')}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={file} onValueChange={setFile}>
            <SelectTrigger className="h-8 w-64 shrink-0">
              <SelectValue placeholder={t('settings.logs.file')} />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {files.map((f) => (
                <SelectItem key={f.name} value={f.name}>
                  {f.name}（{fmtSize(f.size)}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={minLevel} onValueChange={(v) => setMinLevel(v as 'all' | LogLevel)}>
            <SelectTrigger className="h-8 w-32 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value="all">{t('settings.logs.allLevels')}</SelectItem>
              {LOG_LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {l.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('settings.logs.searchPlaceholder')}
            className="h-8 w-56"
          />
          <span className="text-xs text-muted-foreground">
            {t('settings.logs.totalLines', { total })} · {t('settings.logs.newestFirst')}
          </span>
        </div>

        <div className="max-h-[480px] overflow-auto rounded-md border border-border bg-muted/30 p-3">
          {lines.length === 0 && !loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('settings.logs.noLogs')}</div>
          ) : (
            <div className="flex flex-col gap-1 font-mono text-xs leading-relaxed">
              {lines.map((l, i) => {
                const m = LOG_LINE_RE.exec(l);
                if (!m) {
                  return (
                    <div key={i} className="whitespace-pre-wrap break-all text-foreground/80">
                      {l}
                    </div>
                  );
                }
                const [, ts, level, scope, rest] = m;
                return (
                  <div key={i} className="flex items-start gap-2 whitespace-pre-wrap break-all">
                    <span className="shrink-0 text-muted-foreground">{ts}</span>
                    <Badge variant="secondary" className={cn('shrink-0 px-1.5 font-mono text-[10px] font-semibold', LEVEL_BADGE_CLASS[level])}>
                      {level}
                    </Badge>
                    {scope && <span className="shrink-0 text-muted-foreground/70">[{scope}]</span>}
                    <span className="min-w-0 text-foreground/90">{rest}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {lines.length < total && (
          <Button variant="outline" size="sm" className="self-center" disabled={loading} onClick={() => void query(lines.length)}>
            {t('settings.logs.loadMore')}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ===== 通用设置 ===== */
export function GeneralSettings() {
  const { t } = useTranslation();
  const { mode, setMode } = useTheme();
  const { locale, setLocale } = useLocale();
  const sendShortcut = useStore((s) => s.sendShortcut);
  const setSendShortcut = useStore((s) => s.setSendShortcut);
  // 主题切换动画的扩散圆心：记录最后一次点击选项的坐标
  const themeOriginRef = useRef<{ x: number; y: number } | undefined>(undefined);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">{t('settings.general.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.general.subtitle')}</p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="text-sm font-medium text-foreground">{t('settings.general.basicSettings')}</div>
        <div className="flex flex-col divide-y divide-border">
          {/* 主题 */}
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex flex-col gap-0.5">
              <div className="text-sm text-foreground">{t('settings.general.theme')}</div>
              <div className="text-xs text-muted-foreground">{t('settings.general.selectTheme')}</div>
            </div>
            <Select
              value={mode}
              onValueChange={(v) =>
                setMode(v as 'system' | 'light' | 'dark', themeOriginRef.current)
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                onPointerDownCapture={(e) => {
                  themeOriginRef.current = { x: e.clientX, y: e.clientY };
                }}
              >
                <SelectItem value="system">
                  <Monitor className="size-3.5" />
                  {t('settings.general.system')}
                </SelectItem>
                <SelectItem value="light">
                  <Sun className="size-3.5" />
                  {t('settings.general.light')}
                </SelectItem>
                <SelectItem value="dark">
                  <Moon className="size-3.5" />
                  {t('settings.general.dark')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 语言 */}
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex flex-col gap-0.5">
              <div className="text-sm text-foreground">{t('settings.general.language')}</div>
              <div className="text-xs text-muted-foreground">{t('settings.general.languageDesc')}</div>
            </div>
            <Select value={locale} onValueChange={(v) => setLocale(v as 'zh' | 'en')}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh">
                  <Globe className="size-3.5" />
                  {t('settings.general.simplifiedChinese')}
                </SelectItem>
                <SelectItem value="en">
                  <Globe className="size-3.5" />
                  {t('settings.general.english')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="text-sm font-medium text-foreground">{t('settings.general.preferences')}</div>
        <div className="flex flex-col divide-y divide-border">
          {/* 发送消息快捷键 */}
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex flex-col gap-0.5">
              <div className="text-sm text-foreground">{t('settings.general.sendShortcut')}</div>
              <div className="text-xs text-muted-foreground">{t('settings.general.sendShortcutDesc')}</div>
            </div>
            <Select
              value={sendShortcut}
              onValueChange={(v) => setSendShortcut(v as 'enter' | 'ctrl-enter')}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enter">{t('settings.general.sendWithEnter')}</SelectItem>
                <SelectItem value="ctrl-enter">{t('settings.general.sendWithCtrlEnter')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex flex-col gap-0.5">
              <div className="text-sm text-foreground">{t('settings.general.editorSettings')}</div>
              <div className="text-xs text-muted-foreground">{t('settings.general.editorSettingsDesc')}</div>
            </div>
            <Button variant="outline">{t('settings.general.goToSettings')}</Button>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex flex-col gap-0.5">
              <div className="text-sm text-foreground">{t('settings.general.shortcutSettings')}</div>
              <div className="text-xs text-muted-foreground">{t('settings.general.shortcutSettingsDesc')}</div>
            </div>
            <Button variant="outline" className="gap-1.5">
              <span>{t('settings.general.vscodeShortcutStyle')}</span>
              <ChevronDown className="size-3.5 opacity-70" />
            </Button>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex flex-col gap-0.5">
              <div className="text-sm text-foreground">{t('settings.general.importConfig')}</div>
              <div className="text-xs text-muted-foreground">{t('settings.general.importConfigDesc')}</div>
            </div>
            <Button variant="outline" className="gap-1.5">
              <span>{t('settings.general.import')}</span>
              <ChevronDown className="size-3.5 opacity-70" />
            </Button>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex flex-col gap-0.5">
              <div className="text-sm text-foreground">{t('settings.general.localLink')}</div>
              <div className="text-xs text-muted-foreground">{t('settings.general.localLinkDesc')}</div>
            </div>
            <Button variant="outline" className="gap-1.5">
              <span>{t('settings.general.systemBrowser')}</span>
              <ChevronDown className="size-3.5 opacity-70" />
            </Button>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex flex-col gap-0.5">
              <div className="text-sm text-foreground">{t('settings.general.markdownOpen')}</div>
              <div className="text-xs text-muted-foreground">{t('settings.general.markdownOpenDesc')}</div>
            </div>
            <Button variant="outline" className="gap-1.5">
              <span>{t('settings.general.codeEditor')}</span>
              <ChevronDown className="size-3.5 opacity-70" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===== 智能体设置 ===== */
export function AgentSettings() {
  const { t } = useTranslation();
  const { agents, setDefaultAgent } = useAgents();
  const builtInAgents = agents.filter((a) => a.builtIn);
  const customAgents = agents.filter((a) => !a.builtIn);

  const renderAgentCard = (agent: (typeof agents)[number]) => {
    const isDefault = !!agent.default;
    return (
      <Card
        key={agent.id}
        className={cn(
          'flex flex-row items-center gap-3 p-3',
          isDefault && 'border-primary ring-2 ring-primary/20',
        )}
      >
        <div
          className={cn(
            'flex size-9 items-center justify-center rounded-lg',
            isDefault ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          <Bot className="size-4" />
        </div>
        <div className="flex flex-1 flex-col gap-0.5 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">{agent.name}</span>
          {agent.description && (
            <span className="text-xs text-muted-foreground truncate">{agent.description}</span>
          )}
        </div>
        {isDefault && (
          <>
            <Check className="size-4 text-primary" />
            <Badge>{t('settings.agent.defaultBadge')}</Badge>
          </>
        )}
        {!isDefault && (
          <Button variant="ghost" size="sm" onClick={() => void setDefaultAgent(agent.id)}>
            {t('common.default')}
          </Button>
        )}
      </Card>
    );
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">{t('settings.agent.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.agent.subtitle')}</p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="text-sm font-medium text-foreground">{t('settings.agent.builtIn')}</div>
        <div className="flex flex-col gap-2">
          {builtInAgents.length === 0 ? (
            <div className="text-xs text-muted-foreground">—</div>
          ) : (
            builtInAgents.map(renderAgentCard)
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="text-sm font-medium text-foreground">{t('settings.agent.custom')}</div>
        <div className="flex flex-col gap-2">
          {customAgents.length === 0 ? (
            <div className="text-xs text-muted-foreground">—</div>
          ) : (
            customAgents.map(renderAgentCard)
          )}
        </div>
      </div>

      <Button variant="outline" className="gap-1.5 self-start">
        <Plus />
        <span>{t('settings.agent.createAgent')}</span>
      </Button>
    </div>
  );
}

/* ===== 模型设置 ===== */
export function ModelSettings() {
  const { t } = useTranslation();
  const { models, currentModel, setCurrent, createModel, updateModel, deleteModel, testModel, reorderModels } = useModels();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelItem | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<'all' | ModelItem['format']>('all');
  const modelDialogRequest = useStore((s) => s.modelDialogRequest);
  const clearModelDialogRequest = useStore((s) => s.clearModelDialogRequest);

  // 从模型菜单"添加自定义模型"跳转过来时自动打开添加弹窗
  useEffect(() => {
    if (modelDialogRequest) {
      clearModelDialogRequest();
      setEditingModel(null);
      setDialogOpen(true);
    }
  }, [modelDialogRequest, clearModelDialogRequest]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const openAdd = () => {
    setEditingModel(null);
    setDialogOpen(true);
  };

  const openEdit = (model: ModelItem) => {
    setEditingModel(model);
    setDialogOpen(true);
  };

  const handleDelete = async (model: ModelItem) => {
    if (!window.confirm(t('settings.model.deleteConfirm'))) return;
    try {
      await deleteModel(model.id);
      toast.success(t('settings.model.deleteSuccess'));
    } catch {
      // 错误已由 hook toast
    }
  };

  const handleTest = async (model: ModelItem) => {
    setTestingId(model.id);
    try {
      const result = await testModel(model.id);
      if (result.success) {
        toast.success(t('settings.model.testSuccess', { latencyMs: result.latencyMs }));
      } else {
        toast.error(t('settings.model.testFail', { error: result.error }));
      }
    } finally {
      setTestingId(null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = models.findIndex((m) => m.id === active.id);
    const newIndex = models.findIndex((m) => m.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const newOrder = arrayMove(models, oldIndex, newIndex).map((m) => m.id);
    void reorderModels(newOrder);
  };

  // 搜索 + API 格式筛选（实时本地过滤）
  const q = query.trim().toLowerCase();
  const visibleModels = models.filter((m) => {
    const matchQ = !q || m.name.toLowerCase().includes(q) || m.model.toLowerCase().includes(q);
    const matchF = formatFilter === 'all' || m.format === formatFilter;
    return matchQ && matchF;
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 页头 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground">{t('settings.model.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('settings.model.subtitle')}</p>
        </div>
        <Button className="gap-1.5" onClick={openAdd}>
          <Plus className="size-3.5" />
          {t('settings.model.addModel')}
        </Button>
      </div>

      {/* 搜索与筛选：桌面端筛选在左、搜索在右、整体靠右；移动端搜索在上、筛选在下 */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Select
          value={formatFilter}
          onValueChange={(v) => setFormatFilter(v as 'all' | ModelItem['format'])}
        >
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('settings.model.allFormats')}</SelectItem>
            <SelectItem value="openai-chat">OpenAI Chat</SelectItem>
            <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
            <SelectItem value="anthropic">Anthropic</SelectItem>
            <SelectItem value="gemini">Gemini</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative w-full sm:max-w-64">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder={t('settings.model.searchPlaceholder')}
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 卡片列表 */}
      {models.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
          {t('settings.model.empty')}
        </div>
      ) : visibleModels.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
          {t('settings.model.noMatch')}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visibleModels.map((m) => m.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {visibleModels.map((model) => (
                <SortableModelCard
                  key={model.id}
                  model={model}
                  isSelected={currentModel === model.id}
                  isTesting={testingId === model.id}
                  onSelect={() => void setCurrent(model.id)}
                  onTest={() => void handleTest(model)}
                  onEdit={() => openEdit(model)}
                  onDelete={() => void handleDelete(model)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <AddModelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingModel={editingModel}
        createModel={createModel}
        updateModel={updateModel}
      />
    </div>
  );
}

/* ===== 可拖拽模型卡片 ===== */
interface SortableModelCardProps {
  model: ModelItem;
  isSelected: boolean;
  isTesting: boolean;
  onSelect: () => void;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function SortableModelCard({
  model,
  isSelected,
  isTesting,
  onSelect,
  onTest,
  onEdit,
  onDelete,
}: SortableModelCardProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: model.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        'flex items-center gap-3 rounded-xl border p-4 transition-colors',
        isSelected ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-muted/50',
        isDragging && 'opacity-50 shadow-lg',
      )}
    >
      {/* 拖拽手柄 */}
      <button
        type="button"
        className="cursor-grab shrink-0 text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      {/* 主体可点击区域 */}
      <div className="flex flex-1 items-center gap-3 min-w-0 cursor-pointer" onClick={onSelect}>
        {/* 状态点 */}
        <span
          className={cn(
            'size-2.5 shrink-0 rounded-full',
            isSelected ? 'bg-emerald-500' : 'bg-muted-foreground/30',
          )}
        />
        {/* 名称 + 徽章 */}
        <div className="flex flex-1 flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{model.name}</span>
            <span className="text-xs text-muted-foreground truncate">{model.model}</span>
            {isSelected && (
              <Badge variant="secondary" className="font-normal">
                {t('common.default')}
              </Badge>
            )}
          </div>
          {/* 详情行 */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {model.contextWindow && (
              <>
                <span>{model.contextWindow}</span>
                <span className="text-border">·</span>
              </>
            )}
            <span>{model.format}</span>
            {model.thinking?.enabled && (
              <>
                <span className="text-border">·</span>
                <span>{t('settings.model.thinkingMode')}</span>
              </>
            )}
          </div>
        </div>
      </div>
      {/* 操作链接 */}
      <div className="flex items-center gap-4 shrink-0">
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          onClick={(e) => {
            e.stopPropagation();
            onTest();
          }}
          disabled={isTesting}
        >
          {isTesting && <Loader2 className="size-3 animate-spin" />}
          {isTesting ? t('settings.model.testing') : t('settings.model.test')}
        </button>
        <button
          type="button"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          {t('settings.model.edit')}
        </button>
        <button
          type="button"
          className="text-muted-foreground transition-colors hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={t('settings.model.delete')}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ===== 模型弹窗（新建/编辑共用） ===== */
interface AddModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingModel: ModelItem | null;
  createModel: ReturnType<typeof useModels>['createModel'];
  updateModel: ReturnType<typeof useModels>['updateModel'];
}

function AddModelDialog({
  open,
  onOpenChange,
  editingModel,
  createModel,
  updateModel,
}: AddModelDialogProps) {
  const { t } = useTranslation();
  const isEdit = !!editingModel;

  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [format, setFormat] = useState<ModelItem['format']>('openai-chat');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [inputTokens, setInputTokens] = useState('');
  const [outputTokens, setOutputTokens] = useState('');
  const [temperature, setTemperature] = useState(1.0);
  const [topP, setTopP] = useState(1.0);
  const [topK, setTopK] = useState(0);
  const [effortLevel, setEffortLevel] = useState<'off' | 'low' | 'medium' | 'high' | 'custom'>('off');
  const [customLabel, setCustomLabel] = useState('');
  const [customEffort, setCustomEffort] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 弹窗打开时同步表单数据
  useEffect(() => {
    if (!open) return;
    if (editingModel) {
      setName(editingModel.name);
      setModel(editingModel.model);
      setFormat(editingModel.format);
      setEndpoint(editingModel.endpoint);
      setApiKey(editingModel.apiKey);
      setInputTokens(
        String(editingModel.inputTokens ?? parseLegacyWindow(editingModel.contextWindow) ?? ''),
      );
      setOutputTokens(String(editingModel.outputTokens ?? ''));
      setTemperature(editingModel.temperature ?? 1.0);
      setTopP(editingModel.topP ?? 1.0);
      setTopK(editingModel.topK ?? 0);
      const lv = toEffortLevel(editingModel.thinking);
      setEffortLevel(lv);
      setCustomLabel(lv === 'custom' ? (editingModel.thinking?.label ?? '') : '');
      setCustomEffort(lv === 'custom' ? (editingModel.thinking?.effort ?? '') : '');
    } else {
      setName('');
      setModel('');
      setFormat('openai-chat');
      setEndpoint('');
      setApiKey('');
      setInputTokens('');
      setOutputTokens('');
      setTemperature(1.0);
      setTopP(1.0);
      setTopK(0);
      setEffortLevel('off');
      setCustomLabel('');
      setCustomEffort('');
    }
  }, [open, editingModel]);

  const handleSubmit = async () => {
    if (!name.trim() || !model.trim() || !endpoint.trim()) {
      toast.error(t('settings.model.empty'));
      return;
    }
    if (effortLevel === 'custom' && !customEffort.trim()) {
      toast.error(t('settings.model.customEffortRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        model: model.trim(),
        format,
        endpoint: endpoint.trim(),
        apiKey: apiKey.trim(),
        inputTokens: inputTokens.trim() ? Math.max(1, Math.floor(Number(inputTokens))) : undefined,
        outputTokens: outputTokens.trim()
          ? Math.max(1, Math.floor(Number(outputTokens)))
          : undefined,
        temperature,
        topP,
        topK,
        thinking:
          effortLevel === 'off'
            ? { enabled: false }
            : effortLevel === 'custom'
              ? {
                  enabled: true,
                  effort: customEffort.trim(),
                  ...(customLabel.trim() ? { label: customLabel.trim() } : {}),
                }
              : { enabled: true, effort: effortLevel },
      };
      if (isEdit && editingModel) {
        await updateModel(editingModel.id, payload);
        toast.success(t('settings.model.updateSuccess'));
      } else {
        await createModel(payload);
        toast.success(t('settings.model.createSuccess'));
      }
      onOpenChange(false);
    } catch {
      // 错误已由 hook toast
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('settings.model.editModelTitle') : t('settings.model.addModelTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* 显示名 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model-name">{t('settings.model.displayName')}</Label>
            <Input
              id="model-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('settings.model.displayNamePlaceholder')}
            />
          </div>
          {/* 模型id */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model-model">{t('settings.model.modelName')}</Label>
            <Input
              id="model-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={t('settings.model.modelNamePlaceholder')}
            />
          </div>
          {/* API 格式 */}
          <div className="flex flex-col gap-1.5">
            <Label>{t('settings.model.apiFormat')}</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as ModelItem['format'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai-chat">OpenAI Chat</SelectItem>
                <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* Endpoint */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model-endpoint">{t('settings.model.endpoint')}</Label>
            <Input
              id="model-endpoint"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={t('settings.model.endpointPlaceholder')}
            />
          </div>
          {/* API Key */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model-apikey">{t('settings.model.apiKey')}</Label>
            <Input
              id="model-apikey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('settings.model.apiKeyPlaceholder')}
            />
          </div>
          {/* 高级配置（默认折叠） */}
          <Collapsible defaultOpen={false}>
            <CollapsibleTrigger className="group flex w-full items-center gap-1 rounded-md py-1 text-sm text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground">
              <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
              <span>{t('settings.model.advancedConfig')}</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-col gap-3 pt-1">
                {/* 上下文窗口：输入 / 输出 */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="model-input-tokens">{t('settings.model.inputWindow')}</Label>
                    <Input
                      id="model-input-tokens"
                      type="number"
                      min={1}
                      value={inputTokens}
                      onChange={(e) => setInputTokens(e.target.value)}
                      placeholder="200000"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="model-output-tokens">{t('settings.model.outputWindow')}</Label>
                    <Input
                      id="model-output-tokens"
                      type="number"
                      min={1}
                      value={outputTokens}
                      onChange={(e) => setOutputTokens(e.target.value)}
                      placeholder="8192"
                    />
                  </div>
                </div>
                {/* 模型温度 */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label>{t('settings.model.temperature')}</Label>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {temperature.toFixed(1)}
                    </span>
                  </div>
                  <Slider
                    value={[temperature]}
                    min={0}
                    max={2}
                    step={0.1}
                    onValueChange={(v) => setTemperature(v[0] ?? 1)}
                  />
                </div>
                {/* Top P */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label>{t('settings.model.topP')}</Label>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {topP.toFixed(2)}
                    </span>
                  </div>
                  <Slider
                    value={[topP]}
                    min={0}
                    max={1}
                    step={0.05}
                    onValueChange={(v) => setTopP(v[0] ?? 1)}
                  />
                </div>
                {/* Top K */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label>{t('settings.model.topK')}</Label>
                    <span className="text-sm tabular-nums text-muted-foreground">{topK}</span>
                  </div>
                  <Slider
                    value={[topK]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(v) => setTopK(Math.round(v[0] ?? 0))}
                  />
                </div>
                {/* 思考强度 */}
                <div className="flex flex-col gap-1.5">
                  <Label>{t('settings.model.thinkingLevel')}</Label>
                  <Select
                    value={effortLevel}
                    onValueChange={(v) => setEffortLevel(v as typeof effortLevel)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">{t('settings.model.thinkingOff')}</SelectItem>
                      <SelectItem value="low">{t('settings.model.thinkingLow')}</SelectItem>
                      <SelectItem value="medium">{t('settings.model.thinkingMedium')}</SelectItem>
                      <SelectItem value="high">{t('settings.model.thinkingHigh')}</SelectItem>
                      <SelectItem value="custom">{t('settings.model.thinkingCustom')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* 自定义等级：名称 + 参数 */}
                {effortLevel === 'custom' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="model-custom-label">{t('settings.model.customName')}</Label>
                      <Input
                        id="model-custom-label"
                        value={customLabel}
                        onChange={(e) => setCustomLabel(e.target.value)}
                        placeholder="Deep"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="model-custom-effort">{t('settings.model.customEffort')}</Label>
                      <Input
                        id="model-custom-effort"
                        value={customEffort}
                        onChange={(e) => setCustomEffort(e.target.value)}
                        placeholder="xhigh"
                      />
                    </div>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('settings.model.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {t('settings.model.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ===== 关于页面 ===== */
export function AboutSettings() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">{t('settings.about.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.about.subtitle')}</p>
      </div>

      <div className="flex flex-col items-center gap-2 py-6">
        <div className="size-16 overflow-hidden rounded-2xl">
          <img src="/MOSS.png" alt="MOSS" className="size-full object-cover" />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="text-sm font-medium text-foreground">{t('settings.about.relatedLinks')}</div>
        <div className="flex flex-col gap-1">
          <Button
            variant="outline"
            className="justify-start gap-2"
            onClick={() => window.open('https://github.com/ZCX-Priv/MOSS-OS', '_blank')}
          >
            <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span className="flex-1 text-left">GitHub</span>
            <ExternalLink className="size-3.5 text-muted-foreground" />
          </Button>
          <Button variant="outline" className="justify-start gap-2">
            <Book className="size-4" />
            <span className="flex-1 text-left">{t('settings.about.docs')}</span>
            <ExternalLink className="size-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">{t('settings.about.copyright')}</div>
    </div>
  );
}

/* ===== 工具设置（内置/自定义工具启停 + 执行策略） ===== */
export function ToolsSettings() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const { tools, toggleTool } = useTools();
  const { appConfig, updateAppConfig } = useConfig();
  const [maxTurnsDraft, setMaxTurnsDraft] = useState('');

  const agentCfg = appConfig?.agent;
  const maxTurns = agentCfg?.maxTurns ?? 0;
  const unlimited = maxTurns === 0;

  // config 外部变更（含 WS 热更新）时回填输入框草稿
  useEffect(() => {
    setMaxTurnsDraft(maxTurns === 0 ? '' : String(maxTurns));
  }, [maxTurns]);

  const patchMaxTurns = async (v: number) => {
    if (!agentCfg || v === maxTurns) return;
    try {
      await updateAppConfig({ agent: { ...agentCfg, maxTurns: v } });
    } catch {
      // toast 已在 useConfig 内处理
    }
  };

  /** 失焦/回车提交：clamp 到 [200, 100000]；未变化或非法则回退显示原值 */
  const commitMaxTurnsDraft = () => {
    if (unlimited) return;
    const raw = maxTurnsDraft.trim();
    if (raw === '' || raw === String(maxTurns)) {
      setMaxTurnsDraft(String(maxTurns));
      return;
    }
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n <= 0) {
      setMaxTurnsDraft(String(maxTurns));
      return;
    }
    const clamped = Math.max(200, Math.min(100000, n));
    setMaxTurnsDraft(String(clamped));
    void patchMaxTurns(clamped);
  };

  const q = query.trim().toLowerCase();
  const filteredTools = q
    ? tools.filter(
        (tool) =>
          tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q),
      )
    : tools;

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* 页头：说明与搜索同一行（移动端换行堆叠） */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground">{t('settings.nav.tools')}</h1>
          <p className="text-sm text-muted-foreground">{t('settings.tools.subtitle')}</p>
        </div>
        <div className="relative w-full sm:w-64 sm:shrink-0">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder={t('settings.tools.searchPlaceholder')}
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 执行策略：工具调用最大轮数（面向小时级长程任务） */}
      <Card className="flex flex-col gap-3 p-4">
        <div className="text-sm font-medium text-foreground">{t('settings.tools.execPolicyTitle')}</div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm text-foreground">{t('settings.tools.maxTurnsLabel')}</span>
            <span className="text-xs text-muted-foreground">{t('settings.tools.maxTurnsDesc')}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {unlimited ? (
              <span className="text-sm tabular-nums text-muted-foreground">
                {t('settings.tools.maxTurnsUnlimited')}
              </span>
            ) : (
              <Input
                type="number"
                min={200}
                max={100000}
                value={maxTurnsDraft}
                onChange={(e) => setMaxTurnsDraft(e.target.value)}
                onBlur={commitMaxTurnsDraft}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                className="h-8 w-24 text-right"
                aria-label={t('settings.tools.maxTurnsLabel')}
              />
            )}
            <Switch
              checked={unlimited}
              onCheckedChange={(v) => void patchMaxTurns(v ? 0 : 200)}
              aria-label={t('settings.tools.maxTurnsUnlimited')}
            />
          </div>
        </div>
        {!unlimited && (
          <div className="text-xs text-muted-foreground">{t('settings.tools.maxTurnsMinHint')}</div>
        )}
      </Card>

      <div className="flex flex-col gap-2">
        {filteredTools.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t('settings.tools.noTools')}
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
                    {tool.source === 'builtin' ? t('settings.tools.builtin') : t('settings.tools.custom')}
                  </Badge>
                  {tool.annotations?.destructiveHint && (
                    <Badge variant="secondary" className="font-normal text-amber-600">
                      {t('settings.tools.destructive')}
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

/* ===== 规范设置（Spec 查看与编辑） ===== */
export function SpecsSettings() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
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
      toast.error(err instanceof Error ? err.message : t('settings.specs.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const save = useCallback(async () => {
    if (!detail || saving) return;
    setSaving(true);
    try {
      await api.updateSpec(detail.id, content);
      toast.success(t('settings.specs.saved'));
      setDetail(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.specs.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [detail, content, saving, t]);

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* 规范设置（上下文页「规范」Tab 内容；标题由外层 Tab 示名） */}

      <div className="relative w-64">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder={t('settings.specs.searchPlaceholder')}
          className="pl-8"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        {filteredSpecs.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t('settings.specs.noSpecs')}
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
                  {spec.source === 'builtin' ? t('settings.tools.builtin') : t('settings.tools.custom')}
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

/* ===== 占位 section 路由组件（按 section 查表渲染 PlaceholderSettings） ===== */
const PLACEHOLDER_SECTION_KEYS: Record<string, { titleKey: string; descKey: string }> = {
  index: { titleKey: 'settings.placeholder.indexTitle', descKey: 'settings.placeholder.indexDesc' },
  appearance: { titleKey: 'settings.placeholder.appearanceTitle', descKey: 'settings.placeholder.appearanceDesc' },
  commands: { titleKey: 'settings.placeholder.commandsTitle', descKey: 'settings.placeholder.commandsDesc' },
  rules: { titleKey: 'settings.placeholder.rulesTitle', descKey: 'settings.placeholder.rulesDesc' },
  memory: { titleKey: 'settings.placeholder.memoryTitle', descKey: 'settings.placeholder.memoryDesc' },
  hooks: { titleKey: 'settings.placeholder.hooksTitle', descKey: 'settings.placeholder.hooksDesc' },
};

export function PlaceholderSection({ section, embedded }: { section: string; embedded?: boolean }) {
  const { t } = useTranslation();
  const keys = PLACEHOLDER_SECTION_KEYS[section] ?? PLACEHOLDER_SECTION_KEYS.hooks;
  return <PlaceholderSettings title={t(keys.titleKey)} description={t(keys.descKey)} embedded={embedded} />;
}

/* ===== 占位页面（用于未详细设计的设置子页面） ===== */
function PlaceholderSettings({
  title,
  description,
  embedded,
}: {
  title: string;
  description: string;
  /** Tab 内嵌模式：不渲染 h1（标题由外层 Tab 示名） */
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean>(true);

  return (
    <div className="flex flex-col gap-6 p-6">
      {!embedded && (
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="text-sm font-medium text-foreground">{t('settings.placeholder.baseSettings')}</div>
        <div className="flex flex-col divide-y divide-border">
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex flex-col gap-0.5">
              <div className="text-sm text-foreground">{title}{t('settings.placeholder.configSuffix')}</div>
              <div className="text-xs text-muted-foreground">{description}</div>
            </div>
            <Button variant="outline" className="gap-1.5">
              <span>{t('common.default')}</span>
              <ChevronDown className="size-3.5 opacity-70" />
            </Button>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex flex-col gap-0.5">
              <div className="text-sm text-foreground">{t('common.enable')}</div>
              <div className="text-xs text-muted-foreground">{t('settings.placeholder.enableDesc')}</div>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label={enabled ? t('common.close') : t('common.open')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
