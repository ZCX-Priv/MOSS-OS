import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Mic,
  ArrowUp,
  ChevronDown,
  Sparkles,
  Monitor,
  FolderOpen,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface PlanModeInputProps {
  open: boolean;
  onClose: () => void;
}

const quickActionKeys = [
  'planMode.quickActions.appDev',
  'planMode.quickActions.projectUnderstand',
  'planMode.quickActions.gameIdea',
  'planMode.quickActions.toolScript',
];

export function PlanModeInput({ open, onClose }: PlanModeInputProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-4 sm:max-w-2xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('planMode.placeholder')}</DialogTitle>
        </DialogHeader>

        <Card className="w-full gap-0 rounded-2xl p-2 shadow-sm">
          <div className="flex items-center gap-2 px-1">
            <Badge variant="default" className="gap-1">
              <Sparkles className="size-3" />
              Plan
            </Badge>
            <Input
              type="text"
              placeholder={t('planMode.placeholder')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
              className="border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-1 pt-1.5">
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="icon-sm" title={t('common.attachment')}>
                <Plus />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-full"
                title={t('common.plugin')}
              >
                <Sparkles className="size-3.5" />
                <span>{t('common.plugin')}</span>
                <ChevronDown className="size-3 opacity-70" />
                <Badge variant="secondary" className="font-normal">
                  +1
                </Badge>
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-full"
              >
                <span className="size-1.5 rounded-full bg-primary" />
                <span>GLM-5.2</span>
                <ChevronDown className="size-3 opacity-70" />
              </Button>
              <Button variant="ghost" size="icon-sm" title={t('common.voiceInput')}>
                <Mic />
              </Button>
              <Button
                size="icon-sm"
                variant={input.trim() ? 'default' : 'secondary'}
                disabled={!input.trim()}
                title={t('common.send')}
              >
                <ArrowUp />
              </Button>
            </div>
          </div>
        </Card>

        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1 rounded-full px-2 py-1 font-normal">
            <Monitor className="size-3" />
            <span>{t('planMode.local')}</span>
            <ChevronDown className="size-3 opacity-70" />
          </Badge>
          <Badge variant="secondary" className="gap-1 rounded-full px-2 py-1 font-normal">
            <FolderOpen className="size-3" />
            <span>MOSS</span>
            <ChevronDown className="size-3 opacity-70" />
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {quickActionKeys.map((key) => (
            <Button key={key} variant="outline" size="sm">
              {t(key)}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
