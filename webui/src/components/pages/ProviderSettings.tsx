// UI/src/components/pages/ProviderSettings.tsx
// 服务商设置页：服务商卡片（API 格式/地址/Key/自定义查询地址）+ 旗下模型管理。
// - 添加服务商（可选自定义余额查询地址、模型列表获取地址）
// - 新建后自动拉取远程模型列表 → 勾选弹窗（实时搜索）批量添加
// - 手动添加模型（名称 + 模型 id + 模型级高级配置）
// - 余额查询（CircleDollarSign 按钮 → 弹窗，OpenAI 兼容计费格式解析）

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Plus,
  Search,
  Trash2,
  GripVertical,
  Loader2,
  ChevronRight,
  CircleDollarSign,
  RefreshCw,
} from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useProviders, type UseProvidersResult } from '../../hooks/useProviders';
import { useStore } from '../../store';
import { parseLegacyWindow, toEffortLevel } from '../../lib/model-utils';
import type { ProviderItem, ProviderModelItem, RemoteModelItem } from '../../types/api';

const FORMAT_OPTIONS = [
  { value: 'openai-chat', label: 'OpenAI Chat' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Gemini' },
] as const;

/* ===== 服务商设置页 ===== */
export function ProviderSettings() {
  const { t } = useTranslation();
  const {
    providers,
    currentModel,
    setCurrent,
    reorderProviders,
    deleteProvider,
    fetchProviderModels,
  } = useProviders();
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderItem | null>(null);
  const [pickProvider, setPickProvider] = useState<ProviderItem | null>(null);
  const [balanceProvider, setBalanceProvider] = useState<ProviderItem | null>(null);
  const [modelDialogProvider, setModelDialogProvider] = useState<ProviderItem | null>(null);
  const [editingModel, setEditingModel] = useState<ProviderModelItem | null>(null);
  const [query, setQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<'all' | ProviderItem['format']>('all');
  const providerDialogRequest = useStore((s) => s.providerDialogRequest);
  const clearProviderDialogRequest = useStore((s) => s.clearProviderDialogRequest);

  // 从模型选择器"添加服务商"跳转过来时自动打开添加弹窗
  useEffect(() => {
    if (providerDialogRequest) {
      clearProviderDialogRequest();
      setEditingProvider(null);
      setProviderDialogOpen(true);
    }
  }, [providerDialogRequest, clearProviderDialogRequest]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const openAdd = () => {
    setEditingProvider(null);
    setProviderDialogOpen(true);
  };

  const openEdit = (provider: ProviderItem) => {
    setEditingProvider(provider);
    setProviderDialogOpen(true);
  };

  const openAddModel = (provider: ProviderItem) => {
    setModelDialogProvider(provider);
    setEditingModel(null);
  };

  const openEditModel = (provider: ProviderItem, model: ProviderModelItem) => {
    setModelDialogProvider(provider);
    setEditingModel(model);
  };

  const openPick = (provider: ProviderItem) => {
    setPickProvider(provider);
  };

  const handleDelete = async (provider: ProviderItem) => {
    if (
      !window.confirm(
        t('settings.provider.deleteConfirm', { count: provider.models.length }),
      )
    ) {
      return;
    }
    try {
      await deleteProvider(provider.id);
      toast.success(t('settings.provider.deleteSuccess'));
    } catch {
      // 错误已由 hook toast
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = providers.findIndex((p) => p.id === active.id);
    const newIndex = providers.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const newOrder = arrayMove(providers, oldIndex, newIndex).map((p) => p.id);
    void reorderProviders(newOrder);
  };

  // 搜索（服务商名/地址/旗下模型名或 id）+ API 格式筛选（实时本地过滤）
  const q = query.trim().toLowerCase();
  const visibleProviders = providers.filter((p) => {
    const matchQ =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.endpoint.toLowerCase().includes(q) ||
      p.models.some(
        (m) => m.name.toLowerCase().includes(q) || m.model.toLowerCase().includes(q),
      );
    const matchF = formatFilter === 'all' || p.format === formatFilter;
    return matchQ && matchF;
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 页头 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground">
            {t('settings.provider.title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('settings.provider.subtitle')}</p>
        </div>
        <Button className="gap-1.5" onClick={openAdd}>
          <Plus className="size-3.5" />
          {t('settings.provider.addProvider')}
        </Button>
      </div>

      {/* 搜索与筛选 */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Select
          value={formatFilter}
          onValueChange={(v) => setFormatFilter(v as 'all' | ProviderItem['format'])}
        >
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('settings.provider.allFormats')}</SelectItem>
            {FORMAT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative w-full sm:max-w-64">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder={t('settings.provider.searchPlaceholder')}
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 服务商卡片列表 */}
      {providers.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
          {t('settings.provider.empty')}
        </div>
      ) : visibleProviders.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
          {t('settings.provider.noMatch')}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={visibleProviders.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-3">
              {visibleProviders.map((provider) => (
                <SortableProviderCard
                  key={provider.id}
                  provider={provider}
                  currentModel={currentModel}
                  onSelectModel={(modelId) => void setCurrent(modelId)}
                  onBalance={() => setBalanceProvider(provider)}
                  onEdit={() => openEdit(provider)}
                  onDelete={() => void handleDelete(provider)}
                  onAddModel={() => openAddModel(provider)}
                  onEditModel={(model) => openEditModel(provider, model)}
                  onFetchModels={() => openPick(provider)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* 服务商新建/编辑弹窗（新建成功后自动拉取模型列表） */}
      <AddProviderDialog
        open={providerDialogOpen}
        onOpenChange={setProviderDialogOpen}
        editingProvider={editingProvider}
        onCreated={setPickProvider}
      />

      {/* 远程模型勾选弹窗（实时搜索） */}
      {pickProvider && (
        <ModelPickDialog
          open={!!pickProvider}
          onOpenChange={(o) => {
            if (!o) setPickProvider(null);
          }}
          provider={pickProvider}
          fetchProviderModels={fetchProviderModels}
        />
      )}

      {/* 余额查询弹窗 */}
      {balanceProvider && (
        <BalanceDialog
          open={!!balanceProvider}
          onOpenChange={(o) => {
            if (!o) setBalanceProvider(null);
          }}
          provider={balanceProvider}
        />
      )}

      {/* 手动添加/编辑模型弹窗 */}
      {modelDialogProvider && (
        <ProviderModelDialog
          open={!!modelDialogProvider}
          onOpenChange={(o) => {
            if (!o) {
              setModelDialogProvider(null);
              setEditingModel(null);
            }
          }}
          provider={modelDialogProvider}
          editingModel={editingModel}
        />
      )}
    </div>
  );
}

/* ===== 可拖拽服务商卡片 ===== */
interface SortableProviderCardProps {
  provider: ProviderItem;
  currentModel: string;
  onSelectModel: (modelId: string) => void;
  onBalance: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddModel: () => void;
  onEditModel: (model: ProviderModelItem) => void;
  onFetchModels: () => void;
}

function SortableProviderCard({
  provider,
  currentModel,
  onSelectModel,
  onBalance,
  onEdit,
  onDelete,
  onAddModel,
  onEditModel,
  onFetchModels,
}: SortableProviderCardProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: provider.id,
  });
  const [testingId, setTestingId] = useState<string | null>(null);
  const { testProviderModel, deleteProviderModel } = useProviders();

  const handleTest = async (model: ProviderModelItem) => {
    setTestingId(model.id);
    try {
      const result = await testProviderModel(provider.id, model.id);
      if (result.success) {
        toast.success(t('settings.provider.testSuccess', { latencyMs: result.latencyMs }));
      } else {
        toast.error(t('settings.provider.testFail', { error: result.error }));
      }
    } finally {
      setTestingId(null);
    }
  };

  const handleDeleteModel = async (model: ProviderModelItem) => {
    if (!window.confirm(t('settings.provider.deleteModelConfirm'))) return;
    try {
      await deleteProviderModel(provider.id, model.id);
      toast.success(t('settings.provider.deleteModelSuccess'));
    } catch {
      // 错误已由 hook toast
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'rounded-xl border border-border transition-colors',
        isDragging && 'opacity-50 shadow-lg',
      )}
    >
      {/* 卡片头 */}
      <div className="flex items-center gap-3 border-b border-border/60 p-4">
        <button
          type="button"
          className="cursor-grab shrink-0 text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{provider.name}</span>
            <Badge variant="secondary" className="font-normal">
              {provider.format}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {t('settings.provider.modelCount', { count: provider.models.length })}
            </span>
          </div>
          <span className="truncate text-xs text-muted-foreground">{provider.endpoint}</span>
        </div>
        {/* 操作区 */}
        <div className="flex shrink-0 items-center gap-4">
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onBalance();
            }}
            aria-label={t('settings.provider.balanceTitle')}
            title={t('settings.provider.balanceTitle')}
          >
            <CircleDollarSign className="size-3.5" />
          </button>
          <button
            type="button"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            {t('settings.provider.edit')}
          </button>
          <button
            type="button"
            className="text-muted-foreground transition-colors hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label={t('settings.provider.delete')}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {/* 模型行列表 */}
      <div className="flex flex-col">
        {provider.models.length === 0 ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            {t('settings.provider.noModels')}
          </div>
        ) : (
          provider.models.map((model) => {
            const isSelected = currentModel === model.id;
            const isTesting = testingId === model.id;
            return (
              <div
                key={model.id}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 transition-colors',
                  isSelected ? 'bg-primary/5' : 'hover:bg-muted/50',
                )}
              >
                {/* 主体可点击区域 */}
                <div
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                  onClick={() => onSelectModel(model.id)}
                >
                  {/* 状态点 */}
                  <span
                    className={cn(
                      'size-2.5 shrink-0 rounded-full',
                      isSelected ? 'bg-emerald-500' : 'bg-muted-foreground/30',
                    )}
                  />
                  {/* 名称 + 徽章 */}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{model.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{model.model}</span>
                      {isSelected && (
                        <Badge variant="secondary" className="font-normal">
                          {t('common.default')}
                        </Badge>
                      )}
                    </div>
                    {model.inputTokens && (
                      <span className="text-xs text-muted-foreground">
                        {t('settings.provider.inputWindow')}: {model.inputTokens.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                {/* 操作链接 */}
                <div className="flex shrink-0 items-center gap-4">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleTest(model);
                    }}
                    disabled={isTesting}
                  >
                    {isTesting && <Loader2 className="size-3 animate-spin" />}
                    {isTesting ? t('settings.provider.testing') : t('settings.provider.test')}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditModel(model);
                    }}
                  >
                    {t('settings.provider.edit')}
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground transition-colors hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDeleteModel(model);
                    }}
                    aria-label={t('settings.provider.delete')}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 卡片尾：添加模型 / 获取模型列表 */}
      <div className="flex items-center gap-2 border-t border-border/60 px-4 py-2.5">
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onAddModel}>
          <Plus className="size-3" />
          {t('settings.provider.addModel')}
        </Button>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onFetchModels}>
          <RefreshCw className="size-3" />
          {t('settings.provider.fetchModels')}
        </Button>
      </div>
    </div>
  );
}

/* ===== 服务商弹窗（新建/编辑共用；新建成功后自动拉取模型列表） ===== */
interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingProvider: ProviderItem | null;
  /** 新建成功后回调（用于打开模型勾选弹窗） */
  onCreated: (provider: ProviderItem) => void;
}

function AddProviderDialog({
  open,
  onOpenChange,
  editingProvider,
  onCreated,
}: AddProviderDialogProps) {
  const { t } = useTranslation();
  const isEdit = !!editingProvider;
  const { createProvider, updateProvider, fetchProviderModels } = useProviders();

  const [name, setName] = useState('');
  const [format, setFormat] = useState<ProviderItem['format']>('openai-chat');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [balanceUrl, setBalanceUrl] = useState('');
  const [modelsUrl, setModelsUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 弹窗打开时同步表单数据
  useEffect(() => {
    if (!open) return;
    if (editingProvider) {
      setName(editingProvider.name);
      setFormat(editingProvider.format);
      setEndpoint(editingProvider.endpoint);
      setApiKey(''); // 留空 = 不修改
      setBalanceUrl(editingProvider.balanceUrl ?? '');
      setModelsUrl(editingProvider.modelsUrl ?? '');
    } else {
      setName('');
      setFormat('openai-chat');
      setEndpoint('');
      setApiKey('');
      setBalanceUrl('');
      setModelsUrl('');
    }
  }, [open, editingProvider]);

  const handleSubmit = async () => {
    if (!name.trim() || !endpoint.trim()) {
      toast.error(t('settings.provider.fieldsRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        format,
        endpoint: endpoint.trim(),
        apiKey: apiKey.trim(),
        ...(balanceUrl.trim() ? { balanceUrl: balanceUrl.trim() } : {}),
        ...(modelsUrl.trim() ? { modelsUrl: modelsUrl.trim() } : {}),
      };
      if (isEdit && editingProvider) {
        await updateProvider(editingProvider.id, payload);
        toast.success(t('settings.provider.updateSuccess'));
      } else {
        const provider = await createProvider(payload);
        toast.success(t('settings.provider.createSuccess'));
        // 新建成功 → 自动拉取远程模型列表
        const result = await fetchProviderModels(provider.id);
        if (result.success && result.models.length > 0) {
          onCreated(provider);
        } else if (!result.success) {
          toast.error(t('settings.provider.fetchFail', { error: result.error ?? '' }));
        }
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
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t('settings.provider.editProviderTitle')
              : t('settings.provider.addProviderTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* 服务商名称 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-name">{t('settings.provider.providerName')}</Label>
            <Input
              id="provider-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('settings.provider.providerNamePlaceholder')}
            />
          </div>
          {/* API 格式 */}
          <div className="flex flex-col gap-1.5">
            <Label>{t('settings.provider.apiFormat')}</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as ProviderItem['format'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMAT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* API 地址 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-endpoint">{t('settings.provider.endpoint')}</Label>
            <Input
              id="provider-endpoint"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={t('settings.provider.endpointPlaceholder')}
            />
          </div>
          {/* API Key */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-apikey">{t('settings.provider.apiKey')}</Label>
            <Input
              id="provider-apikey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isEdit ? t('settings.provider.apiKeyKeep') : 'sk-...'}
            />
          </div>
          {/* 高级设置（默认折叠）：自定义余额查询地址 / 模型列表获取地址 */}
          <Collapsible defaultOpen={false}>
            <CollapsibleTrigger className="group flex w-full items-center gap-1 rounded-md py-1 text-sm text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground">
              <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
              <span>{t('settings.provider.advancedConfig')}</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-col gap-3 pt-1">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="provider-balance-url">{t('settings.provider.balanceUrl')}</Label>
                  <Input
                    id="provider-balance-url"
                    value={balanceUrl}
                    onChange={(e) => setBalanceUrl(e.target.value)}
                    placeholder={t('settings.provider.balanceUrlPlaceholder')}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="provider-models-url">{t('settings.provider.modelsUrl')}</Label>
                  <Input
                    id="provider-models-url"
                    value={modelsUrl}
                    onChange={(e) => setModelsUrl(e.target.value)}
                    placeholder={t('settings.provider.modelsUrlPlaceholder')}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('settings.provider.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            {t('settings.provider.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ===== 远程模型勾选弹窗（实时搜索 + 已添加标记 + 批量添加） ===== */
interface ModelPickDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderItem;
  fetchProviderModels: UseProvidersResult['fetchProviderModels'];
}

function ModelPickDialog({ open, onOpenChange, provider, fetchProviderModels }: ModelPickDialogProps) {
  const { t } = useTranslation();
  const { addProviderModels } = useProviders();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteModels, setRemoteModels] = useState<RemoteModelItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadModels = async () => {
    setLoading(true);
    setError(null);
    setRemoteModels([]);
    setSelected(new Set());
    try {
      const result = await fetchProviderModels(provider.id);
      if (result.success) {
        setRemoteModels(result.models);
        if (result.models.length === 0) {
          setError(t('settings.provider.noRemoteModels'));
        }
      } else {
        setError(result.error ?? t('settings.provider.fetchFailUnknown'));
      }
    } finally {
      setLoading(false);
    }
  };

  // 弹窗打开时拉取
  useEffect(() => {
    if (open) {
      setQuery('');
      void loadModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider.id]);

  // 实时搜索过滤（模型 id / 显示名包含关键词，大小写不敏感）
  const q = query.trim().toLowerCase();
  const filtered = remoteModels.filter((m) => !q || m.id.toLowerCase().includes(q) || (m.name ?? '').toLowerCase().includes(q));

  // 已存在于服务商的模型（禁止重复添加）
  const existingModels = new Set(provider.models.map((m) => m.model));

  const toggle = (modelId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else {
        next.add(modelId);
      }
      return next;
    });
  };

  // 全选（当前过滤结果中未添加的项）
  const selectableFiltered = filtered.filter((m) => !existingModels.has(m.id));
  const allSelected =
    selectableFiltered.length > 0 && selectableFiltered.every((m) => selected.has(m.id));
  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const m of selectableFiltered) next.delete(m.id);
      } else {
        for (const m of selectableFiltered) next.add(m.id);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    setSubmitting(true);
    try {
      const models = remoteModels
        .filter((m) => selected.has(m.id))
        .map((m) => ({ name: m.name ?? m.id, model: m.id }));
      const result = await addProviderModels(provider.id, models);
      toast.success(t('settings.provider.addSelectedSuccess', { count: result.added }));
      onOpenChange(false);
    } catch {
      // 错误已由 hook toast
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('settings.provider.pickTitle', { name: provider.name })}</DialogTitle>
        </DialogHeader>

        {/* 实时搜索框 */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder={t('settings.provider.pickSearchPlaceholder')}
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        {/* 模型列表 */}
        <div className="min-h-40 max-h-80 overflow-y-auto rounded-lg border border-border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('settings.provider.fetchingModels')}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 p-6 text-sm text-muted-foreground">
              <span>{t('settings.provider.fetchFail', { error })}</span>
              <Button variant="outline" size="sm" className="gap-1" onClick={() => void loadModels()}>
                <RefreshCw className="size-3" />
                {t('settings.provider.retry')}
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
              {t('settings.provider.noRemoteModels')}
            </div>
          ) : (
            <>
              {/* 全选行 */}
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background px-3 py-2">
                <Checkbox
                  id="pick-select-all"
                  checked={allSelected}
                  onCheckedChange={toggleSelectAll}
                  disabled={selectableFiltered.length === 0}
                />
                <Label
                  htmlFor="pick-select-all"
                  className="cursor-pointer text-xs text-muted-foreground"
                >
                  {t('settings.provider.selectAll')}
                </Label>
              </div>
              {filtered.map((m) => {
                const exists = existingModels.has(m.id);
                const checked = selected.has(m.id);
                return (
                  <div
                    key={m.id}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2 transition-colors',
                      exists ? 'opacity-60' : 'hover:bg-muted/50',
                    )}
                  >
                    <Checkbox
                      id={`pick-${m.id}`}
                      checked={checked}
                      onCheckedChange={() => toggle(m.id)}
                      disabled={exists}
                    />
                    <Label
                      htmlFor={`pick-${m.id}`}
                      className={cn(
                        'flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm',
                        exists && 'cursor-not-allowed',
                      )}
                    >
                      <span className="truncate">{m.name ?? m.id}</span>
                      <span className="truncate text-xs text-muted-foreground">{m.id}</span>
                    </Label>
                    {exists && (
                      <Badge variant="secondary" className="shrink-0 font-normal">
                        {t('settings.provider.alreadyAdded')}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        <DialogFooter className="items-center">
          <span className="mr-auto text-xs text-muted-foreground">
            {t('settings.provider.selectedCount', { count: selected.size })}
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('settings.provider.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || selected.size === 0}>
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            {t('settings.provider.addSelected', { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ===== 余额查询弹窗（OpenAI 兼容计费格式：总额度 - 已用量） ===== */
interface BalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderItem;
}

function BalanceDialog({ open, onOpenChange, provider }: BalanceDialogProps) {
  const { t } = useTranslation();
  const { fetchProviderBalance } = useProviders();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    totalUsd?: number;
    usedUsd?: number;
    balanceUsd?: number;
    error?: string;
  } | null>(null);

  const queryBalance = async () => {
    setLoading(true);
    setResult(null);
    try {
      const r = await fetchProviderBalance(provider.id);
      setResult(r);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setResult(null);
      void queryBalance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider.id]);

  const fmt = (v: number | undefined) =>
    v !== undefined ? `$${v.toFixed(2)}` : '-';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('settings.provider.balanceTitle')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="text-sm font-medium text-foreground">{provider.name}</div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('settings.provider.balanceLoading')}
            </div>
          ) : !result ? null : result.success ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('settings.provider.balanceTotal')}</span>
                <span className="tabular-nums text-foreground">{fmt(result.totalUsd)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('settings.provider.balanceUsed')}</span>
                <span className="tabular-nums text-foreground">{fmt(result.usedUsd)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-medium">
                <span className="text-muted-foreground">
                  {t('settings.provider.balanceRemaining')}
                </span>
                <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
                  {fmt(result.balanceUsd)}
                </span>
              </div>
            </div>
          ) : result.error === 'BALANCE_URL_NOT_CONFIGURED' ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {t('settings.provider.balanceNotConfigured')}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 p-4 text-sm text-destructive">
              <span>{t('settings.provider.balanceQueryFail', { error: result.error ?? '' })}</span>
              <Button variant="outline" size="sm" className="gap-1" onClick={() => void queryBalance()}>
                <RefreshCw className="size-3" />
                {t('settings.provider.retry')}
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('settings.provider.close')}
          </Button>
          {!loading && result?.success && (
            <Button className="gap-1" onClick={() => void queryBalance()}>
              <RefreshCw className="size-3.5" />
              {t('settings.provider.refresh')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ===== 模型弹窗（手动添加/编辑共用；模型级高级配置保留） ===== */
interface ProviderModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderItem;
  editingModel: ProviderModelItem | null;
}

function ProviderModelDialog({
  open,
  onOpenChange,
  provider,
  editingModel,
}: ProviderModelDialogProps) {
  const { t } = useTranslation();
  const isEdit = !!editingModel;
  const { addProviderModels, updateProviderModel } = useProviders();

  const [name, setName] = useState('');
  const [model, setModel] = useState('');
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
    if (!name.trim() || !model.trim()) {
      toast.error(t('settings.provider.modelFieldsRequired'));
      return;
    }
    if (effortLevel === 'custom' && !customEffort.trim()) {
      toast.error(t('settings.provider.customEffortRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const advanced = {
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
        await updateProviderModel(provider.id, editingModel.id, {
          name: name.trim(),
          model: model.trim(),
          ...advanced,
        });
        toast.success(t('settings.provider.updateModelSuccess'));
      } else {
        await addProviderModels(provider.id, [{ name: name.trim(), model: model.trim(), ...advanced }]);
        toast.success(t('settings.provider.addModelSuccess'));
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
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t('settings.provider.editModelTitle')
              : t('settings.provider.addModelTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* 模型名称 */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pm-name">{t('settings.provider.modelName')}</Label>
            <Input
              id="pm-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('settings.provider.modelNamePlaceholder')}
            />
          </div>
          {/* 模型 id */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pm-model">{t('settings.provider.modelId')}</Label>
            <Input
              id="pm-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={t('settings.provider.modelIdPlaceholder')}
            />
          </div>
          {/* 高级配置（默认折叠） */}
          <Collapsible defaultOpen={isEdit}>
            <CollapsibleTrigger className="group flex w-full items-center gap-1 rounded-md py-1 text-sm text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground">
              <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
              <span>{t('settings.provider.advancedConfig')}</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-col gap-3 pt-1">
                {/* 上下文窗口：输入 / 输出 */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pm-input-tokens">{t('settings.provider.inputWindow')}</Label>
                    <Input
                      id="pm-input-tokens"
                      type="number"
                      min={1}
                      value={inputTokens}
                      onChange={(e) => setInputTokens(e.target.value)}
                      placeholder="200000"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pm-output-tokens">{t('settings.provider.outputWindow')}</Label>
                    <Input
                      id="pm-output-tokens"
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
                    <Label>{t('settings.provider.temperature')}</Label>
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
                    <Label>{t('settings.provider.topP')}</Label>
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
                    <Label>{t('settings.provider.topK')}</Label>
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
                  <Label>{t('settings.provider.thinkingLevel')}</Label>
                  <Select
                    value={effortLevel}
                    onValueChange={(v) => setEffortLevel(v as typeof effortLevel)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">{t('settings.provider.thinkingOff')}</SelectItem>
                      <SelectItem value="low">{t('settings.provider.thinkingLow')}</SelectItem>
                      <SelectItem value="medium">{t('settings.provider.thinkingMedium')}</SelectItem>
                      <SelectItem value="high">{t('settings.provider.thinkingHigh')}</SelectItem>
                      <SelectItem value="custom">{t('settings.provider.thinkingCustom')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* 自定义等级：名称 + 参数 */}
                {effortLevel === 'custom' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="pm-custom-label">{t('settings.provider.customName')}</Label>
                      <Input
                        id="pm-custom-label"
                        value={customLabel}
                        onChange={(e) => setCustomLabel(e.target.value)}
                        placeholder="Deep"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="pm-custom-effort">{t('settings.provider.customEffort')}</Label>
                      <Input
                        id="pm-custom-effort"
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
            {t('settings.provider.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            {t('settings.provider.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
