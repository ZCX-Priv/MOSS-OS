// UI/src/components/overlays/AgentSwitchMenu.tsx
// Agent 切换菜单：阶段4.3 对接 useAgents + store，移除硬编码。
// builtIn / custom 两个分组；选中后设为默认并关闭。

import { useTranslation } from 'react-i18next';
import { Bot, Plus, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { useAgents } from '../../hooks/useAgents';

interface AgentSwitchMenuProps {
  open: boolean;
  onClose: () => void;
}

export function AgentSwitchMenu({ open, onClose }: AgentSwitchMenuProps) {
  const { t } = useTranslation();
  const { agents, currentAgent, setDefaultAgent } = useAgents();

  const builtinAgents = agents.filter((a) => a.builtIn);
  const customAgents = agents.filter((a) => !a.builtIn);

  const handleSelect = (id: string) => {
    if (id === currentAgent) {
      onClose();
      return;
    }
    void setDefaultAgent(id)
      .then(() => onClose())
      .catch(() => {
        // 错误已由 hook toast，不关闭对话框以便用户重试
      });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" className="gap-0 overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('agentSwitch.builtIn')}</DialogTitle>
        </DialogHeader>
        <Command>
          <CommandList>
            {builtinAgents.length > 0 && (
              <CommandGroup heading={t('agentSwitch.builtIn')}>
                {builtinAgents.map((agent) => (
                  <CommandItem
                    key={agent.id}
                    value={agent.name}
                    onSelect={() => handleSelect(agent.id)}
                  >
                    <Bot />
                    <span className="flex-1 truncate">{agent.name}</span>
                    {agent.default && (
                      <span className="text-xs text-muted-foreground">
                        {t('modelSelector.default', { defaultValue: '默认' })}
                      </span>
                    )}
                    {currentAgent === agent.id && <Check />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {customAgents.length > 0 && (
              <CommandGroup heading={t('agentSwitch.custom')}>
                {customAgents.map((agent) => (
                  <CommandItem
                    key={agent.id}
                    value={agent.name}
                    onSelect={() => handleSelect(agent.id)}
                  >
                    <Bot />
                    <span className="flex-1 truncate">{agent.name}</span>
                    {currentAgent === agent.id && <Check />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {agents.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {t('agentSwitch.noAgents')}
              </div>
            )}
          </CommandList>
        </Command>
        <div className="border-t p-1">
          <Button variant="ghost" className="w-full justify-start gap-1.5" size="sm">
            <Plus />
            <span>{t('agentSwitch.createAgent')}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
