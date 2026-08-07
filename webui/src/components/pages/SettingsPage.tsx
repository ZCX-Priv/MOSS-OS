import { useState, useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Settings,
  Bot,
  Brain,
  MessageSquare,
  Globe,
  FileText,
  Wrench,
  ClipboardList,
  Anchor,
  Info,
  Search,
  ChevronDown,
  Check,
  Sun,
  Moon,
  Monitor,
  Plus,
  GitBranch,
  Book,
  ExternalLink,
  Database,
  Terminal,
  Layers,
  Trash2,
  GripVertical,
  Loader2,
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
import type { PageType, SettingsSection } from '../../types';
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useModels } from '../../hooks/useModels';
import { useAgents } from '../../hooks/useAgents';
import { useStore } from '../../store';
import type { ModelItem, ThinkingEffort } from '../../types/api';

interface SettingsPageProps {
  onNavigate: (page: PageType) => void;
}

interface NavItem {
  id: SettingsSection;
  labelKey: string;
  Icon: LucideIcon;
}

const navItems: NavItem[] = [
  { id: 'general', labelKey: 'settings.nav.general', Icon: Settings },
  { id: 'agent', labelKey: 'settings.nav.agent', Icon: Bot },
  { id: 'model', labelKey: 'settings.nav.model', Icon: Brain },
  { id: 'chat', labelKey: 'settings.nav.chat', Icon: MessageSquare },
  { id: 'index', labelKey: 'settings.nav.index', Icon: Layers },
  { id: 'docs', labelKey: 'settings.nav.docs', Icon: FileText },
  { id: 'skills', labelKey: 'settings.nav.skills', Icon: Wrench },
  { id: 'commands', labelKey: 'settings.nav.commands', Icon: Terminal },
  { id: 'rules', labelKey: 'settings.nav.rules', Icon: ClipboardList },
  { id: 'memory', labelKey: 'settings.nav.memory', Icon: Database },
  { id: 'hooks', labelKey: 'settings.nav.hooks', Icon: Anchor },
  { id: 'about', labelKey: 'settings.nav.about', Icon: Info },
];

export function SettingsPage({ onNavigate: _onNavigate }: SettingsPageProps) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [searchQuery, setSearchQuery] = useState('');

  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        return <GeneralSettings />;
      case 'agent':
        return <AgentSettings />;
      case 'model':
        return <ModelSettings />;
      case 'about':
        return <AboutSettings />;
      case 'chat':
        return (
          <PlaceholderSettings
            title={t('settings.placeholder.chatTitle')}
            description={t('settings.placeholder.chatDesc')}
          />
        );
      case 'index':
        return (
          <PlaceholderSettings
            title={t('settings.placeholder.indexTitle')}
            description={t('settings.placeholder.indexDesc')}
          />
        );
      case 'docs':
        return (
          <PlaceholderSettings
            title={t('settings.placeholder.docsTitle')}
            description={t('settings.placeholder.docsDesc')}
          />
        );
      case 'skills':
        return (
          <PlaceholderSettings
            title={t('settings.placeholder.skillsTitle')}
            description={t('settings.placeholder.skillsDesc')}
          />
        );
      case 'commands':
        return (
          <PlaceholderSettings
            title={t('settings.placeholder.commandsTitle')}
            description={t('settings.placeholder.commandsDesc')}
          />
        );
      case 'rules':
        return (
          <PlaceholderSettings
            title={t('settings.placeholder.rulesTitle')}
            description={t('settings.placeholder.rulesDesc')}
          />
        );
      case 'memory':
        return (
          <PlaceholderSettings
            title={t('settings.placeholder.memoryTitle')}
            description={t('settings.placeholder.memoryDesc')}
          />
        );
      case 'hooks':
        return (
          <PlaceholderSettings
            title={t('settings.placeholder.hooksTitle')}
            description={t('settings.placeholder.hooksDesc')}
          />
        );
      default:
        return <GeneralSettings />;
    }
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* 左侧导航栏 */}
      <aside className="flex w-60 flex-col border-r border-border">
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t('settings.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
          {navItems.map((item) => (
            <Button
              key={item.id}
              variant={activeSection === item.id ? 'secondary' : 'ghost'}
              className="justify-start gap-2"
              onClick={() => setActiveSection(item.id)}
            >
              <item.Icon className="size-4" />
              <span>{t(item.labelKey)}</span>
            </Button>
          ))}
        </nav>
      </aside>

      {/* 右侧内容区域 */}
      <section className="flex-1 overflow-auto">{renderContent()}</section>
    </div>
  );
}

/* ===== 通用设置 ===== */
function GeneralSettings() {
  const { t } = useTranslation();
  const { mode, setMode } = useTheme();
  const { locale, setLocale } = useLocale();
  const sendShortcut = useStore((s) => s.sendShortcut);
  const setSendShortcut = useStore((s) => s.setSendShortcut);

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold text-foreground">{t('settings.general.title')}</h1>

      <div className="flex flex-col gap-3">
        <div className="text-sm font-medium text-foreground">{t('settings.general.basicSettings')}</div>
        <div className="flex flex-col divide-y divide-border">
          {/* 主题 */}
          <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex flex-col gap-0.5">
              <div className="text-sm text-foreground">{t('settings.general.theme')}</div>
              <div className="text-xs text-muted-foreground">{t('settings.general.selectTheme')}</div>
            </div>
            <Select value={mode} onValueChange={(v) => setMode(v as 'system' | 'light' | 'dark')}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
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
function AgentSettings() {
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
      <h1 className="text-xl font-semibold text-foreground">{t('settings.agent.title')}</h1>

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
function ModelSettings() {
  const { t } = useTranslation();
  const { models, currentModel, setCurrent, createModel, updateModel, deleteModel, testModel, reorderModels } = useModels();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelItem | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

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

      {/* 卡片列表 */}
      {models.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
          {t('settings.model.empty')}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={models.map((m) => m.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {models.map((model) => (
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
  const [contextWindow, setContextWindow] = useState<string>('200k');
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [thinkingEffort, setThinkingEffort] = useState<'high' | 'xhigh'>('xhigh');
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
      setContextWindow(editingModel.contextWindow ?? '200k');
      setThinkingEnabled(editingModel.thinking?.enabled ?? false);
      setThinkingEffort(editingModel.thinking?.effort === 'high' ? 'high' : 'xhigh');
    } else {
      setName('');
      setModel('');
      setFormat('openai-chat');
      setEndpoint('');
      setApiKey('');
      setContextWindow('200k');
      setThinkingEnabled(false);
      setThinkingEffort('xhigh');
    }
  }, [open, editingModel]);

  const handleSubmit = async () => {
    if (!name.trim() || !model.trim() || !endpoint.trim()) {
      toast.error(t('settings.model.empty'));
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
        contextWindow,
        thinking: { enabled: thinkingEnabled, effort: thinkingEffort as ThinkingEffort },
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
          {/* 上下文窗口 */}
          <div className="flex flex-col gap-1.5">
            <Label>{t('settings.model.contextWindow')}</Label>
            <Select value={contextWindow} onValueChange={setContextWindow}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="200k">200k</SelectItem>
                <SelectItem value="400k">400k</SelectItem>
                <SelectItem value="1m">1m</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* 思考模式 */}
          <div className="flex items-center justify-between gap-4 py-1">
            <div className="flex flex-col gap-0.5">
              <div className="text-sm text-foreground">{t('settings.model.thinkingMode')}</div>
              <div className="text-xs text-muted-foreground">
                {t('settings.model.thinkingModeDesc')}
              </div>
            </div>
            <Switch
              checked={thinkingEnabled}
              onCheckedChange={setThinkingEnabled}
              aria-label={t('settings.model.thinkingMode')}
            />
          </div>
          {/* 默认思考强度 */}
          {thinkingEnabled && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <Label>{t('settings.model.defaultThinkingEffort')}</Label>
                <div className="text-xs text-muted-foreground">
                  {t('settings.model.defaultThinkingEffortDesc')}
                </div>
              </div>
              <ToggleGroup
                type="single"
                value={thinkingEffort}
                onValueChange={(v) => v && setThinkingEffort(v as 'high' | 'xhigh')}
                variant="outline"
                className="w-full"
              >
                <ToggleGroupItem value="high" className="flex-1">
                  high
                </ToggleGroupItem>
                <ToggleGroupItem value="xhigh" className="flex-1 gap-1">
                  max
                  <Badge variant="secondary" className="font-normal">
                    {t('modelSelector.default')}
                  </Badge>
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}
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
function AboutSettings() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold text-foreground">{t('settings.about.title')}</h1>

      <div className="flex flex-col items-center gap-2 py-6">
        <div className="size-16 overflow-hidden rounded-2xl">
          <img src="/MOSS.png" alt="MOSS" className="size-full object-cover" />
        </div>
        <div className="text-sm text-muted-foreground">{t('settings.about.version')}</div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="text-sm font-medium text-foreground">{t('settings.about.relatedLinks')}</div>
        <div className="flex flex-col gap-1">
          <Button variant="outline" className="justify-start gap-2">
            <Globe className="size-4" />
            <span className="flex-1 text-left">{t('settings.about.officialWebsite')}</span>
            <ExternalLink className="size-3.5 text-muted-foreground" />
          </Button>
          <Button variant="outline" className="justify-start gap-2">
            <Book className="size-4" />
            <span className="flex-1 text-left">{t('settings.about.docs')}</span>
            <ExternalLink className="size-3.5 text-muted-foreground" />
          </Button>
          <Button variant="outline" className="justify-start gap-2">
            <GitBranch className="size-4" />
            <span className="flex-1 text-left">GitHub</span>
            <ExternalLink className="size-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">{t('settings.about.copyright')}</div>
    </div>
  );
}

/* ===== 占位页面（用于未详细设计的设置子页面） ===== */
function PlaceholderSettings({ title, description }: { title: string; description: string }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean>(true);

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold text-foreground">{title}</h1>

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
