'use client';

import { useParams } from 'next/navigation';
import ChatThread from '@/components/chat/ChatThread';

export default function ChatThreadPage() {
  const { chatId } = useParams<{ chatId: string }>();

  return <ChatThread conversationId={chatId} />;
}
