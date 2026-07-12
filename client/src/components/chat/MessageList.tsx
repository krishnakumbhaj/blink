'use client';

import { useEffect, useRef } from 'react';
import dayjs from 'dayjs';
import calendar from 'dayjs/plugin/calendar';
import MessageBubble from './MessageBubble';
import Avatar from './Avatar';
import type { DeleteScope } from '@/lib/chat-api';
import type { ChatMessage, ChatUser } from '@/types/chat';

dayjs.extend(calendar);

interface MessageListProps {
  messages: ChatMessage[];
  currentUserId: string;
  otherUser: ChatUser;
  onRead: () => void;
  onDeleteMessage: (message: ChatMessage, scope: DeleteScope) => void;
  onForwardMessage: (message: ChatMessage) => void;
}

/** "Today" / "Yesterday" / "12 Jul 2026" */
function dayLabel(iso: string): string {
  return dayjs(iso).calendar(null, {
    sameDay: '[Today]',
    lastDay: '[Yesterday]',
    lastWeek: 'dddd',
    sameElse: 'D MMM YYYY',
  });
}

export default function MessageList({
  messages,
  currentUserId,
  otherUser,
  onRead,
  onDeleteMessage,
  onForwardMessage,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Only auto-scroll if they were already near the bottom. Yanking someone
    // back down while they are reading older messages is infuriating.
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    if (distanceFromBottom < 140) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      onRead();
    }
  }, [messages, onRead]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <Avatar username={otherUser.username} avatarUrl={otherUser.avatarUrl} size="lg" />
        <div>
          <p className="font-semibold text-foreground">{otherUser.username}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            You follow each other. Say hello.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={onRead}
      className="scrollbar-slim flex-1 space-y-1.5 overflow-y-auto px-4 py-4"
    >
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const isNewDay = !previous || !dayjs(previous.createdAt).isSame(message.createdAt, 'day');

        return (
          <div key={message.id} className="space-y-1.5">
            {isNewDay && (
              <div className="flex justify-center py-3">
                <span className="rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-muted-foreground">
                  {dayLabel(message.createdAt)}
                </span>
              </div>
            )}

            <MessageBubble
              message={message}
              isOwn={message.senderId === currentUserId}
              onDelete={(scope) => onDeleteMessage(message, scope)}
              onForward={() => onForwardMessage(message)}
            />
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
