// webui/src/components/pages/settings/ToolEditDialog.tsx
// 工具编辑对话框：自定义工具参数（tool.json config 段声明的字段）与通用行为
// （启用状态、执行前确认）。保存写入 config.tools[name]，后端热生效。

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Pencil, RotateCcw, Wrench } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { TOOL_ICON_MAP } from '../../../lib/tool-icons';
import type { ToolItem } from '../../../types/api';

interface ToolEditDialogProps {
  tool: ToolItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 保存整表配置（enabled + requireConfirmation + 参数字段）；成功后由父组件关闭对话框 */
  onSave: (name: string, config: Record<string, unknown>) => Promise<void>;
}

/** 从工具条目构建表单初始值 */
function buildInitialForm(tool: ToolItem): Record<string, unknown> {
  const form: Record<string, unknown> = {
    enabled: tool.enabled,
    requireConfirmation:
      tool.configValues?.requireConfirmation ?? tool.annotations?.requireConfirmation ?? false,
  };
  for (const f of tool.configFields ?? []) {
    form[f.key] = tool.configValues?.[f.key] ?? f.default;
  }
  return form;
}

export function ToolEditDialog({ tool, open, onOpenChange, onSave }: ToolEditDialogProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  // 打开或切换工具时重置表单为当前生效值
  useEffect(() => {
    if (tool && open) {
      setForm(buildInitialForm(tool));
      setSaving(false);
    }
  }, [tool, open]);

  if (!tool) return null;

  const Icon = TOOL_ICON_MAP[tool.icon ?? ''] ?? Wrench;
  const paramFields = tool.configFields ?? [];

  const setField = (key: string, value: unknown) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /** 重置为默认值：enabled=true、requireConfirmation=注解默认、参数=声明默认 */
  const resetDefaults = () => {
    const form: Record<string, unknown> = {
      enabled: true,
      requireConfirmation: tool.annotations?.requireConfirmation ?? false,
    };
    for (const f of paramFields) form[f.key] = f.default;
    setForm(form);
  };

  /** 校验并收集整表配置；非法输入返回 null（已 toast 提示） */
  const collectConfig = (): Record<string, unknown> | null => {
    const config: Record<string, unknown> = {
      enabled: Boolean(form.enabled),
      requireConfirmation: Boolean(form.requireConfirmation),
    };
    for (const f of paramFields) {
      if (f.type === 'integer') {
        const raw = String(form[f.key] ?? '').trim();
        const n = Number(raw);
        if (raw === '' || !Number.isFinite(n)) {
          toast.error(t('settings.tools.invalidNumber', { field: f.key }));
          return null;
        }
        let v = Math.round(n);
        if (f.min !== undefined && v < f.min) v = f.min;
        if (f.max !== undefined && v > f.max) v = f.max;
        config[f.key] = v;
      } else if (f.type === 'boolean') {
        config[f.key] = Boolean(form[f.key]);
      } else {
        config[f.key] = String(form[f.key] ?? '');
      }
    }
    return config;
  };

  const handleSave = async () => {
    const config = collectConfig();
    if (!config) return;
    setSaving(true);
    try {
      await onSave(tool.name, config);
    } catch {
      // toast 已在 onSave 内部处理
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-4 text-muted-foreground" />
            {t('settings.tools.editToolTitle', { name: tool.name })}
          </DialogTitle>
          <DialogDescription className="line-clamp-2">{tool.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          {/* 通用行为：所有工具都可编辑 */}
          <div className="text-sm font-medium text-foreground">
            {t('settings.tools.behaviorSection')}
          </div>
          <div className="flex items-center justify-between gap-4 py-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Label htmlFor="tool-enabled" className="text-sm font-normal text-foreground">
                {t('settings.tools.enabledLabel')}
              </Label>
            </div>
            <Switch
              id="tool-enabled"
              checked={Boolean(form.enabled)}
              onCheckedChange={(v) => setField('enabled', v)}
            />
          </div>
          <div className="flex items-center justify-between gap-4 py-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Label htmlFor="tool-confirm" className="text-sm font-normal text-foreground">
                {t('settings.tools.requireConfirmationLabel')}
              </Label>
              <span className="text-xs text-muted-foreground">
                {t('settings.tools.requireConfirmationDesc')}
              </span>
            </div>
            <Switch
              id="tool-confirm"
              checked={Boolean(form.requireConfirmation)}
              onCheckedChange={(v) => setField('requireConfirmation', v)}
            />
          </div>

          {/* 工具参数：仅声明了 config 段字段的工具显示 */}
          {paramFields.length > 0 && (
            <>
              <Separator className="my-3" />
              <div className="text-sm font-medium text-foreground">
                {t('settings.tools.paramsSection')}
              </div>
              <div className="flex flex-col divide-y divide-border">
                {paramFields.map((f) => (
                  <div key={f.key} className="flex items-center justify-between gap-4 py-2.5">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <Label
                        htmlFor={`tool-field-${f.key}`}
                        className="text-sm font-normal text-foreground"
                      >
                        {f.key}
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        {t('settings.tools.defaultValue', {
                          value: String(f.default),
                        })}
                        {f.type === 'integer' && f.min !== undefined && f.max !== undefined
                          ? ` · ${t('settings.tools.rangeHint', { min: f.min, max: f.max })}`
                          : ''}
                      </span>
                    </div>
                    <div className="shrink-0">
                      {f.type === 'boolean' ? (
                        <Switch
                          id={`tool-field-${f.key}`}
                          checked={Boolean(form[f.key])}
                          onCheckedChange={(v) => setField(f.key, v)}
                        />
                      ) : f.type === 'integer' ? (
                        <Input
                          id={`tool-field-${f.key}`}
                          type="number"
                          className="h-8 w-28 text-right"
                          value={String(form[f.key] ?? '')}
                          min={f.min}
                          max={f.max}
                          onChange={(e) => setField(f.key, e.target.value)}
                        />
                      ) : (
                        <Input
                          id={`tool-field-${f.key}`}
                          type="text"
                          className="h-8 w-40"
                          value={String(form[f.key] ?? '')}
                          onChange={(e) => setField(f.key, e.target.value)}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex-row items-center gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetDefaults}
            disabled={saving}
          >
            <RotateCcw className="size-3.5" />
            {t('settings.tools.resetDefaults')}
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              <Pencil className="size-3.5" />
              {t('common.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
