import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import type { PageType } from '../../types';
import { SidebarMenuButton } from '@/components/ui/sidebar';

interface UserMenuProps {
  onNavigate: (page: PageType) => void;
}

export function UserMenu({ onNavigate }: UserMenuProps) {
  const { t } = useTranslation();

  return (
    <SidebarMenuButton
      size="lg"
      className="gap-2"
      tooltip={t('userMenu.settings')}
      onClick={() => onNavigate('settings')}
    >
      <Settings className="size-4" />
      <div className="flex min-w-0 flex-col gap-0 leading-none group-data-[collapsible=icon]:hidden">
        <span className="truncate text-sm font-medium">{t('userMenu.settings')}</span>
      </div>
    </SidebarMenuButton>
  );
}
