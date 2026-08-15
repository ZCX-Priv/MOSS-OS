import { useTranslation } from 'react-i18next';
import { FileText, ListChecks, Sparkles, FileCode, Puzzle, LogOut } from 'lucide-react';
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
import { useSkills } from '@/hooks/useSkills';
import { useSpecs } from '@/hooks/useSpecs';
import { usePlugins } from '@/hooks/usePlugins';

interface SlashCommandMenuProps {
  open: boolean;
  onClose: () => void;
  /** 选择命令时触发，返回命令文本（如 /spec、/skill:xxx）供父组件回填输入框 */
  onSelect?: (command: string) => void;
}

interface SlashCommand {
  id: string;
  name: string;
  desc: string;
  icon: typeof FileText;
  /** 选择时回填的命令文本 */
  command: string;
}

export function SlashCommandMenu({ open, onClose, onSelect }: SlashCommandMenuProps) {
  const { t } = useTranslation();
  const { skills } = useSkills();
  const { specs } = useSpecs();
  const { plugins } = usePlugins();

  const handleSelect = (cmd: SlashCommand): void => {
    onSelect?.(cmd.command);
    onClose();
  };

  // 内置命令
  const builtinCommands: SlashCommand[] = [
    {
      id: 'spec',
      name: 'Spec',
      desc: t('slashCommand.specDesc'),
      icon: FileText,
      command: '/spec',
    },
    {
      id: 'plan',
      name: 'Plan',
      desc: t('slashCommand.planDesc'),
      icon: ListChecks,
      command: '/plan',
    },
    {
      id: 'skill-exit',
      name: 'Skill Exit',
      desc: t('slashCommand.skillExitDesc'),
      icon: LogOut,
      command: '/skill:exit',
    },
  ];

  const recentCommands: SlashCommand[] = [
    {
      id: 'plan-recent',
      name: 'Plan',
      desc: t('slashCommand.planDesc'),
      icon: ListChecks,
      command: '/plan',
    },
  ];

  // 从 skills 聚合：/skill:<name>（仅启用的）
  const skillCommands: SlashCommand[] = skills
    .filter((s) => s.enabled !== false)
    .map((s) => ({
      id: `skill:${s.name}`,
      name: `Skill: ${s.name}`,
      desc: s.description,
      icon: Sparkles,
      command: `/skill:${s.name}`,
    }));

  // 从 specs 聚合：/spec:<id>
  const specCommands: SlashCommand[] = specs.map((s) => ({
    id: `spec:${s.id}`,
    name: `Spec: ${s.id}`,
    desc: s.description,
    icon: FileCode,
    command: `/spec:${s.id}`,
  }));

  // 从 plugins 聚合
  const pluginCommands: SlashCommand[] = plugins
    .filter((p) => p.enabled)
    .map((p) => ({
      id: `plugin:${p.id}`,
      name: p.name,
      desc: p.description || t('slashCommand.pluginCommand'),
      icon: Puzzle,
      command: `/plugin:${p.id}`,
    }));

  const renderCommand = (cmd: SlashCommand) => {
    const Icon = cmd.icon;
    return (
      <CommandItem
        key={cmd.id}
        value={`${cmd.name} ${cmd.desc} ${cmd.command}`}
        onSelect={() => handleSelect(cmd)}
      >
        <Icon className="text-muted-foreground" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate">{cmd.name}</span>
          <span className="truncate text-xs text-muted-foreground">{cmd.desc}</span>
        </div>
      </CommandItem>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('slashCommand.commands')}</DialogTitle>
        </DialogHeader>
        <Command>
          <CommandList>
            {recentCommands.length > 0 && (
              <CommandGroup heading={t('slashCommand.recent')}>
                {recentCommands.map(renderCommand)}
              </CommandGroup>
            )}
            <CommandGroup heading={t('slashCommand.commands')}>
              {builtinCommands.map(renderCommand)}
            </CommandGroup>
            {skillCommands.length > 0 && (
              <CommandGroup heading={t('slashCommand.skills')}>
                {skillCommands.map(renderCommand)}
              </CommandGroup>
            )}
            {specCommands.length > 0 && (
              <CommandGroup heading={t('slashCommand.specs')}>
                {specCommands.map(renderCommand)}
              </CommandGroup>
            )}
            {pluginCommands.length > 0 && (
              <CommandGroup heading={t('slashCommand.plugins')}>
                {pluginCommands.map(renderCommand)}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
