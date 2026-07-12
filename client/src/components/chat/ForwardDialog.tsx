'use client';

import { useEffect, useMemo, useState } from 'react';
import { ApiError, forwardMessage } from '@/lib/chat-api';
import { useAuth } from '@/context/AuthContext';
import { useChatContext } from '@/context/ChatContext';
import { useToast } from '@/components/ui/use-toast';
import { Icon, Spinner } from '@/components/ui/icon';
import Avatar from './Avatar';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/types/chat';

interface ForwardDialogProps {
  /** The message being passed on, or null when the dialog is closed. */
  message: ChatMessage | null;
  /** Never offer to forward a chat back into itself. */
  currentConversationId: string;
  onClose: () => void;
}

/** A one-line summary of what is being forwarded, so you can see what you picked. */
function summarise(message: ChatMessage): string {
  const text = message.text.trim();
  if (text) return text;

  const images = message.attachments.filter((a) => a.isImage).length;
  const files = message.attachments.length - images;

  if (images && files) return `${message.attachments.length} attachments`;
  if (images) return images === 1 ? 'Photo' : `${images} photos`;
  return files === 1 ? message.attachments[0].name : `${files} files`;
}

export default function ForwardDialog({
  message,
  currentConversationId,
  onClose,
}: ForwardDialogProps) {
  const { token } = useAuth();
  const { conversations } = useChatContext();
  const { toast } = useToast();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Reset every time it opens, or the previous pick bleeds into the next forward.
  useEffect(() => {
    if (message) {
      setSelected(new Set());
      setQuery('');
    }
  }, [message]);

  useEffect(() => {
    if (!message) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isSending) return;
      // Stop the shell from ALSO closing the whole conversation.
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [message, isSending, onClose]);

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return conversations.filter((conversation) => {
      // Forwarding into the chat you are already in is a no-op with extra steps.
      if (conversation.id === currentConversationId) return false;
      // The server rejects a send to a non-mutual, so do not offer it.
      if (!conversation.otherUser.isMutual) return false;

      return !needle || conversation.otherUser.username.toLowerCase().includes(needle);
    });
  }, [conversations, currentConversationId, query]);

  if (!message) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function send() {
    if (!token || selected.size === 0 || !message) return;
    setIsSending(true);

    try {
      const ids = [...selected];
      await forwardMessage(token, message.id, ids);

      toast({
        title: ids.length === 1 ? 'Message forwarded' : `Forwarded to ${ids.length} chats`,
      });
      onClose();
    } catch (error) {
      toast({
        title: 'Could not forward that',
        description: error instanceof ApiError ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="forward-title"
      onClick={() => !isSending && onClose()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
      >
        <header className="shrink-0 border-b border-border px-5 pb-3 pt-4">
          <h2 id="forward-title" className="text-base font-semibold text-foreground">
            Forward to…
          </h2>

          <p className="mt-1 truncate text-xs text-muted-foreground">{summarise(message)}</p>

          <div className="relative mt-3">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              autoFocus
              className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
            />
          </div>
        </header>

        <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto p-2">
          {candidates.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm leading-relaxed text-muted-foreground">
              {conversations.length <= 1
                ? 'You have no other chats to forward this to yet.'
                : `No chats match “${query}”`}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {candidates.map((conversation) => {
                const isPicked = selected.has(conversation.id);

                return (
                  <li key={conversation.id}>
                    <button
                      onClick={() => toggle(conversation.id)}
                      aria-pressed={isPicked}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-secondary"
                    >
                      <Avatar
                        username={conversation.otherUser.username}
                        avatarUrl={conversation.otherUser.avatarUrl}
                        size="sm"
                      />

                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {conversation.otherUser.username}
                      </span>

                      <span
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition',
                          isPicked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input'
                        )}
                      >
                        {isPicked && <Icon name="tick" size={13} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="flex shrink-0 gap-2 border-t border-border p-3">
          <button
            onClick={onClose}
            disabled={isSending}
            className="h-10 flex-1 rounded-xl border border-input text-sm font-semibold text-foreground transition hover:bg-secondary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void send()}
            disabled={selected.size === 0 || isSending}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40"
          >
            {isSending ? (
              <Spinner size={16} />
            ) : (
              <>
                <Icon name="forward" size={15} />
                Send{selected.size > 0 && ` (${selected.size})`}
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
