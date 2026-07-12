'use client';

import Link from 'next/link';
import dayjs from 'dayjs';
import { cn } from '@/lib/utils';
import Avatar from './Avatar';
import type { Conversation } from '@/types/chat';

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  isOnline: boolean;
  isTyping: boolean;
  currentUserId: string;
}

/** Compact relative time: "09:41" today, "Mon" this week, "12 Jul" beyond. */
function timeLabel(iso: string): string {
  const when = dayjs(iso);
  if (when.isSame(dayjs(), 'day')) return when.format('HH:mm');
  if (when.isAfter(dayjs().subtract(6, 'day'))) return when.format('ddd');
  return when.format('D MMM');
}

export default function ConversationItem({
  conversation,
  isActive,
  isOnline,
  isTyping,
  currentUserId,
}: ConversationItemProps) {
  const { otherUser, lastMessage, unreadCount } = conversation;
  const isMine = lastMessage?.senderId === currentUserId;

  return (
    <Link
      href={`/chat/${conversation.id}`}
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2.5 transition',
        isActive ? 'bg-secondary' : 'hover:bg-secondary/60'
      )}
    >
      <Avatar
        username={otherUser.username}
        avatarUrl={otherUser.avatarUrl}
        showPresence
        isOnline={isOnline}
        // The dot's ring must match what sits behind it, or it looks like a
        // sticker. The active row is `secondary`, the rest are the card.
        ringClass={isActive ? 'ring-secondary' : 'ring-background'}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {otherUser.username}
          </span>

          {lastMessage && (
            <time className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {timeLabel(lastMessage.createdAt)}
            </time>
          )}
        </div>

        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p
            className={cn(
              'truncate text-xs',
              // An unread thread earns bold. Everything else stays quiet.
              unreadCount > 0 ? 'font-medium text-foreground' : 'text-muted-foreground'
            )}
          >
            {isTyping ? (
              <span className="italic text-foreground">typing…</span>
            ) : lastMessage ? (
              <>
                {isMine && <span className="text-muted-foreground">You: </span>}
                {lastMessage.text}
              </>
            ) : (
              'No messages yet'
            )}
          </p>

          {unreadCount > 0 && (
            <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
