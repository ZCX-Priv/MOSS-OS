import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  File,
  Folder,
  Book,
  History,
  Code,
  ClipboardList,
  Layers,
  TriangleAlert,
  Globe,
  ChevronRight,
  FileText,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useStore } from '@/store';
import type { LucideIcon } from 'lucide-react';

interface FileReferenceMenuProps {
  open: boolean;
  onClose: () => void;
}

interface MenuItem {
  id: string;
  labelKey: string;
  icon: LucideIcon;
}

const menuItems: MenuItem[] = [
  { id: 'file', labelKey: 'fileRef.file', icon: File },
  { id: 'folder', labelKey: 'fileRef.folder', icon: Folder },
  { id: 'doc', labelKey: 'fileRef.doc', icon: Book },
  { id: 'past-tasks', labelKey: 'fileRef.pastTasks', icon: History },
  { id: 'code', labelKey: 'fileRef.code', icon: Code },
  { id: 'rule', labelKey: 'fileRef.rule', icon: ClipboardList },
  { id: 'workspace', labelKey: 'fileRef.workspace', icon: Layers },
  { id: 'problems', labelKey: 'fileRef.problems', icon: TriangleAlert },
  { id: 'web', labelKey: 'fileRef.web', icon: Globe },
];

export function FileReferenceMenu({ open, onClose }: FileReferenceMenuProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState('file');

  // 从 store 读取当前 session 的 context files
  const activeSessionId = useStore((s) => s.activeSessionId);
  const context = useStore((s) =>
    activeSessionId
      ? s.contextBySession[activeSessionId]
      : undefined,
  );
  const files = context?.files ?? [];

  const renderContent = (): ReactNode => {
    if (selected === 'file') {
      if (!activeSessionId) {
        return (
          <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
            {t('fileRef.noActiveSession')}
          </div>
        );
      }
      if (files.length === 0) {
        return (
          <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
            {t('fileRef.noContextFiles')}
          </div>
        );
      }
      return (
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-0.5 p-1">
            {files.map((f, idx) => (
              <div
                key={`${f.path}-${idx}`}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate" title={f.path}>{f.path}</span>
                {f.reason && (
                  <Badge variant="secondary" className="shrink-0 font-normal">
                    {f.reason}
                  </Badge>
                )}
              </div>
            ))}
            {context && context.maxTokens > 0 && (
              <div className="mt-2 border-t px-2 py-1.5 text-xs text-muted-foreground">
                {t('fileRef.tokensUsed', {
                  used: context.totalTokens,
                  max: context.maxTokens,
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      );
    }
    // 其他分类暂未对接，显示占位
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        {t('fileRef.comingSoon')}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('fileRef.file')}</DialogTitle>
        </DialogHeader>
        <div className="flex h-80">
          {/* 左侧分类菜单 */}
          <ScrollArea className="w-48 shrink-0 border-r">
            <div className="flex flex-col gap-0.5 p-1">
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = selected === item.id;
                return (
                  <Button
                    key={item.id}
                    variant="ghost"
                    onClick={() => setSelected(item.id)}
                    className={cn(
                      'h-auto w-full justify-start gap-2 px-2 py-2 text-sm',
                      isActive && 'bg-muted text-foreground',
                    )}
                  >
                    <Icon className="size-4" />
                    <span className="flex-1 text-left truncate">
                      {t(item.labelKey)}
                    </span>
                    <ChevronRight className="size-4 opacity-70" />
                  </Button>
                );
              })}
            </div>
          </ScrollArea>
          {/* 右侧内容区 */}
          <div className="flex-1 min-w-0">{renderContent()}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
