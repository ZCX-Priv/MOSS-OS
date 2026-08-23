// UI/src/components/shared/ConfirmDialog.tsx
// 通用确认弹窗：基于 AlertDialog（替代原生 window.confirm）。
// - title 必填；description 可选（危险操作说明文案）
// - destructive=true 时确认按钮为危险色
// - 受控组件：由调用方管理 open 与 onConfirm

import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  /** 确认按钮文案（默认 common.delete） */
  confirmText?: string;
  /** 危险操作：确认按钮红色 */
  destructive?: boolean;
  /** 确认中：按钮禁用 + spinner */
  loading?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  destructive,
  loading,
  onConfirm,
  onOpenChange,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogBody />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={loading}
            className={cn(destructive && 'bg-destructive text-white hover:bg-destructive/80')}
            onClick={(e) => {
              // 阻止 AlertDialog 默认关闭：确认中的关闭由调用方控制
              e.preventDefault();
              onConfirm();
            }}
          >
            {loading && <Loader2 className="size-3.5 animate-spin" />}
            {confirmText ?? t('common.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
