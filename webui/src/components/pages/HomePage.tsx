import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ChatInput } from '../shared/ChatInput';
import { useChat } from '../../hooks/useChat';
import type { OverlayType } from '../../types';

interface HomePageProps {
  onOpenOverlay: (overlay: OverlayType) => void;
}

export function HomePage({ onOpenOverlay }: HomePageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { sendMessage } = useChat();

  const handleSend = useCallback(
    async (text: string) => {
      const taskId = await sendMessage(text);
      if (taskId) navigate(`/task/${taskId}`);
    },
    [sendMessage, navigate],
  );

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-2xl flex-col items-center gap-8">
        {/* Hero */}
        <div className="flex flex-col items-center gap-4">
          <div className="size-16 overflow-hidden rounded-2xl">
            <img src="/MOSS.png" alt="MOSS" className="size-full object-cover" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">{t('home.title')}</h1>
        </div>

        {/* Input */}
        <div className="w-full">
          <ChatInput onOpenOverlay={onOpenOverlay} onSend={handleSend} />
        </div>
      </div>
    </div>
  );
}
