import { useTranslation } from 'react-i18next';
import { Settings, Plus, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { usePlugins, getPluginIconGradient } from '@/hooks/usePlugins';

interface PluginDropdownProps {
  open: boolean;
  onClose: () => void;
}

export function PluginDropdown({ open, onClose }: PluginDropdownProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-2 sm:max-w-sm">
        <DialogHeader className="px-1 pb-1 pt-0.5">
          <DialogTitle className="text-xs font-medium text-muted-foreground">
            {t('pluginDropdown.availablePlugins')}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-0.5">
          {plugins.map((plugin) => {
            const gradient = plugin.iconGradient ?? getPluginIconGradient(plugin.name);
            return (
              <Button
                key={plugin.id}
                variant="ghost"
                className="h-auto w-full justify-start gap-2 px-2 py-2 text-sm"
              >
                <span
                  className="flex size-7 items-center justify-center rounded-md text-xs font-semibold text-white"
                  style={{ backgroundImage: gradient }}
                >
                  {plugin.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate">{plugin.name}</span>
                {!plugin.enabled && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {t('pluginDropdown.disabled')}
                  </span>
                )}
              </Button>
            );
          })}
          {plugins.length === 0 && (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              {t('pluginDropdown.noPlugins')}
            </div>
          )}
        </div>
        <Separator className="my-1" />
        <Button
          variant="ghost"
          className="h-auto w-full justify-start gap-2 px-2 py-2 text-sm"
        >
          <Settings className="text-muted-foreground" />
          <span className="truncate">{t('pluginDropdown.managePlugins')}</span>
        </Button>
        <Button
          variant="ghost"
          className="h-auto w-full justify-start gap-2 px-2 py-2 text-sm"
        >
          <Plus className="text-muted-foreground" />
          <span className="flex-1 truncate text-left">
            {t('pluginDropdown.addPlugin')}
          </span>
          <ExternalLink className="size-3 opacity-70" />
        </Button>
      </DialogContent>
    </Dialog>
  );
}
