'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Icon, Spinner } from '@/components/ui/icon';
import Menu, { type MenuItem } from '@/components/ui/menu';
import ConfirmDialog, { type ConfirmSpec } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/use-toast';
import { ApiError, deleteConversation, type DeleteScope } from '@/lib/chat-api';
import { useAuth } from '@/context/AuthContext';
import { useChatContext } from '@/context/ChatContext';
import { useThread } from '@/hooks/useThread';
import Avatar from './Avatar';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import TypingIndicator from './TypingIndicator';
import ForwardDialog from './ForwardDialog';
import type { ChatMessage } from '@/types/chat';

export default function ChatThread({ conversationId }: { conversationId: string }) {
  const { user, token } = useAuth();
  const { onlineIds, status, refreshConversations } = useChatContext();
  const { toast } = useToast();
  const router = useRouter();

  const {
    conversation,
    messages,
    isLoading,
    error,
    typingUsername,
    send,
    notifyTyping,
    markRead,
    removeMessage,
  } = useThread(conversationId);

  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size={22} className="text-muted-foreground" />
      </div>
    );
  }

  if (!conversation || !user) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <Icon name="alert" size={28} className="text-foreground" />
        <p className="text-sm text-muted-foreground">
          {error ?? 'This conversation is not available.'}
        </p>
        <Link
          href="/chat"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
        >
          Back to messages
        </Link>
      </div>
    );
  }

  const { otherUser } = conversation;
  const isOnline = onlineIds.has(otherUser.id);

  /**
   * Deleting a single message.
   *
   * "For me" is quietly reversible-ish (it is still on their screen), so it goes
   * through without ceremony. "For everyone" destroys the content permanently
   * and changes what the other person sees, so it asks first.
   */
  function handleDeleteMessage(message: ChatMessage, scope: DeleteScope) {
    if (scope === 'me') {
      void removeMessage(message.id, 'me');
      return;
    }

    setConfirm({
      title: 'Delete for everyone?',
      body: `This message will be permanently deleted for you and ${otherUser.username}. They will see that a message was deleted.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        setIsDeleting(true);
        try {
          await removeMessage(message.id, 'everyone');
          setConfirm(null);
        } catch {
          /* useThread already surfaced the error */
        } finally {
          setIsDeleting(false);
        }
      },
    });
  }

  /** Deleting the whole chat. Both scopes confirm — both lose history. */
  function handleDeleteChat(scope: DeleteScope) {
    const spec: ConfirmSpec =
      scope === 'me'
        ? {
            title: 'Delete this chat?',
            body: `The conversation will be cleared from your side only. ${otherUser.username} keeps their copy, and the chat comes back if they message you again.`,
            confirmLabel: 'Delete for me',
            onConfirm: () => void runDeleteChat('me'),
          }
        : {
            title: 'Delete for everyone?',
            body: `Every message in this conversation will be permanently deleted for you and ${otherUser.username}. This cannot be undone.`,
            confirmLabel: 'Delete for everyone',
            onConfirm: () => void runDeleteChat('everyone'),
          };

    setConfirm(spec);
  }

  async function runDeleteChat(scope: DeleteScope) {
    if (!token) return;
    setIsDeleting(true);

    try {
      await deleteConversation(token, conversationId, scope);
      await refreshConversations();

      setConfirm(null);
      router.replace('/chat');

      toast({
        title: scope === 'me' ? 'Chat deleted for you' : 'Chat deleted for everyone',
      });
    } catch (err) {
      toast({
        title: 'Could not delete the chat',
        description: err instanceof ApiError ? err.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  }

  const chatMenu: MenuItem[] = [
    {
      label: 'Delete chat for me',
      icon: 'delete',
      onSelect: () => handleDeleteChat('me'),
      destructive: true,
    },
    {
      label: 'Delete for everyone',
      icon: 'delete',
      onSelect: () => handleDeleteChat('everyone'),
      destructive: true,
    },
  ];

  // The server re-checks the mutual on every send, so a thread can still exist
  // after someone unfollows. Say so plainly instead of letting the send 403.
  const blockedReason = !otherUser.isMutual
    ? otherUser.requestSent
      ? `Waiting for ${otherUser.username} to accept your follow request.`
      : otherUser.followsYou
        ? `Follow ${otherUser.username} back — they'll need to accept — to keep chatting.`
        : `${otherUser.username} no longer follows you, so you can't send messages.`
    : undefined;

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-3 py-3 sm:px-4">
        {/* Mobile only: the sidebar is hidden behind this route. */}
        <Link
          href="/chat"
          aria-label="Back to messages"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground transition hover:bg-secondary md:hidden"
        >
          <Icon name="back" />
        </Link>

        <Avatar
          username={otherUser.username}
          avatarUrl={otherUser.avatarUrl}
          size="sm"
          showPresence
          isOnline={isOnline}
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{otherUser.username}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {typingUsername ? (
              'typing…'
            ) : isOnline ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                Active now
              </>
            ) : (
              'Offline'
            )}
          </p>
        </div>

        <Menu items={chatMenu} label="Chat options" align="right" />
      </header>

      {error && (
        <div className="flex items-center gap-2 border-b border-border border-l-4 border-l-foreground bg-secondary px-4 py-2">
          <Icon name="alert" size={15} className="text-foreground" />
          <p className="text-xs font-medium text-foreground">{error}</p>
        </div>
      )}

      <MessageList
        messages={messages}
        currentUserId={user.id}
        otherUser={otherUser}
        onRead={markRead}
        onDeleteMessage={handleDeleteMessage}
        onForwardMessage={setForwarding}
      />

      <TypingIndicator username={typingUsername} />

      <MessageInput
        onSend={send}
        onTyping={notifyTyping}
        disabled={status !== 'connected'}
        blockedReason={blockedReason}
      />

      <ConfirmDialog spec={confirm} isBusy={isDeleting} onCancel={() => setConfirm(null)} />

      <ForwardDialog
        message={forwarding}
        currentConversationId={conversationId}
        onClose={() => setForwarding(null)}
      />
    </div>
  );
}
