// webui/src/components/overlays/DirectoryPickerDialog.tsx
// 候选路径选择对话框：后端解析出多个同名目录时，让用户从中选择目标文件夹。

import { useTranslation } from 'react-i18next';
import { Folder } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { DirectoryCandidate } from '@/types/api';

interface DirectoryPickerDialogProps {
  open: boolean;
  candidates: DirectoryCandidate[];
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function DirectoryPickerDialog({
  open,
  candidates,
  onSelect,
  onClose,
}: DirectoryPickerDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('directoryPicker.selectTitle')}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="flex flex-col gap-1 pr-2">
            {candidates.map((c) => (
              <button
                key={c.path}
                type="button"
                onClick={() => onSelect(c.path)}
                className="flex items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Folder className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs">{c.path}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{c.parent}</div>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('directoryPicker.manualInput')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
