// UI/src/components/overlays/ConfirmDialog.tsx
// 可复用确认弹窗：基于 AlertDialog，预设 danger / warning / info 三种 variant。
// 受控使用：open + onOpenChange + onConfirm。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlertIcon, InfoIcon, CircleAlertIcon } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

export type ConfirmDialogVariant = 'danger' | 'warning' | 'info';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmDialogVariant;
  onConfirm: () => void | Promise<void>;
}

const variantConfig: Record<
  ConfirmDialogVariant,
  { icon: typeof TriangleAlertIcon; iconClass: string; actionClass: string }
> = {
  danger: {
    icon: CircleAlertIcon,
    iconClass: 'text-destructive',
    actionClass:
      'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20',
  },
  warning: {
    icon: TriangleAlertIcon,
    iconClass: 'text-amber-500',
    actionClass: '',
  },
  info: {
    icon: InfoIcon,
    iconClass: 'text-primary',
    actionClass: '',
  },
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  cancelText,
  variant = 'info',
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const cfg = variantConfig[variant];
  const Icon = cfg.icon;

  const handleConfirm = async () => {
    try {
      setLoading(true);
      await onConfirm();
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="md">
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <Icon className={cn('size-5 shrink-0 translate-y-0.5', cfg.iconClass)} />
            <div className="flex flex-col gap-1">
              <AlertDialogTitle>{title}</AlertDialogTitle>
              {description && (
                <AlertDialogDescription>{description}</AlertDialogDescription>
              )}
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelText ?? t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
            disabled={loading}
            className={cn(variant === 'danger' && cfg.actionClass)}
          >
            {confirmText ?? t('common.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
