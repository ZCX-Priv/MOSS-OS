import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SidebarMenuButton } from '@/components/ui/sidebar';

export function UserMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <SidebarMenuButton
      size="lg"
      className="gap-2"
      tooltip={t('userMenu.settings')}
      onClick={() => navigate('/settings')}
    >
      <Settings className="size-4" />
      <div className="flex min-w-0 flex-col gap-0 leading-none group-data-[collapsible=icon]:hidden">
        <span className="truncate text-sm font-medium">{t('userMenu.settings')}</span>
      </div>
    </SidebarMenuButton>
  );
}
