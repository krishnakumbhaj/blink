'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { useAuth } from '@/context/AuthContext';
import { useChatContext } from '@/context/ChatContext';
import { Icon } from '@/components/ui/icon';
import ConversationItem from './ConversationItem';

/**
 * The middle column: your conversations, and a way to find one.
 *
 * Search here filters the chats you ALREADY have — by name, and by what was last
 * said. Finding new people is a different job and lives in Community. Conflating
 * the two is how you end up searching for a friend and getting a stranger.
 */
export default function ChatList() {
  const { user } = useAuth();
  const { conversations, onlineIds, typingIn, isLoading } = useChatContext();
  const params = useParams<{ chatId?: string }>();

  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;

    return conversations.filter(
      (conversation) =>
        conversation.otherUser.username.toLowerCase().includes(needle) ||
        conversation.lastMessage?.text.toLowerCase().includes(needle)
    );
  }, [conversations, query]);

  return (
    /**
     * Same background as the canvas the chat panel floats on, and NO border on
     * the right. The list and the chat area are one continuous surface; the only
     * thing that reads as a boundary is the panel's own outline.
     */
    <div className="flex h-full flex-col bg-background">
      <header className="shrink-0 px-4 py-3">
        <h1 className="mb-3 text-xl font-semibold text-foreground">Chats</h1>

        <div className="relative">
          <Icon
            name="search"
            size={17}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your chats"
            aria-label="Search your chats"
            className="h-10 w-full rounded-xl border border-input bg-card pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
      </header>

      <div className="scrollbar-slim flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">Loading chats…</p>
        ) : conversations.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border">
              <Icon name="newMessage" size={22} className="text-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">No chats yet</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Find someone in{' '}
              <Link
                href="/chat/people"
                className="font-medium text-foreground underline underline-offset-2"
              >
                Community
              </Link>
              . Once you follow each other, you can start talking.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            No chats match &ldquo;{query}&rdquo;
          </p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((conversation) => (
              <li key={conversation.id}>
                <ConversationItem
                  conversation={conversation}
                  isActive={params?.chatId === conversation.id}
                  isOnline={onlineIds.has(conversation.otherUser.id)}
                  isTyping={Boolean(typingIn[conversation.id])}
                  currentUserId={user?.id ?? ''}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
