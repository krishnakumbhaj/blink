'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  ApiError,
  acceptRequest,
  cancelRequest,
  declineRequest,
  followUser,
  openConversation,
  unfollowUser,
} from '@/lib/chat-api';
import { useAuth } from '@/context/AuthContext';
import { useChatContext } from '@/context/ChatContext';
import { useToast } from '@/components/ui/use-toast';
import { Icon, Spinner } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import Avatar from '@/components/chat/Avatar';
import { getRelationship, type ChatUser, type RelationshipState } from '@/types/chat';

/**
 * Every state says plainly what is going on and what you can do about it. The
 * one thing this must never do is offer a button that then fails — the server
 * rejects a message between non-mutuals, so "Message" only appears on `mutual`.
 */
const COPY: Record<RelationshipState, string> = {
  none: 'Not connected',
  requestSent: 'Request sent — waiting for them',
  requestReceived: 'Wants to follow you',
  following: 'You follow them — they have not followed back',
  // Following back is a REQUEST too, so this must not promise instant chat.
  followsYou: 'Follows you — request to follow them back',
  mutual: 'You follow each other',
};

interface UserRowProps {
  user: ChatUser;
  onChange: (updated: ChatUser) => void;
}

export default function UserRow({ user, onChange }: UserRowProps) {
  const { token } = useAuth();
  const { refreshConversations, refreshRequests } = useChatContext();
  const { toast } = useToast();
  const router = useRouter();

  const [isBusy, setIsBusy] = useState(false);
  const state = getRelationship(user);

  /** Every action reshapes the relationship, so they all funnel through here. */
  async function run(action: () => Promise<ChatUser>, successMessage?: string) {
    if (!token) return;
    setIsBusy(true);

    try {
      onChange(await action());

      // Accepting or following back can unlock a chat; declining can clear a
      // request. Keep the inbox and the badge honest either way.
      await Promise.all([refreshConversations(), refreshRequests()]);

      if (successMessage) toast({ title: successMessage });
    } catch (error) {
      toast({
        title: 'Something went wrong',
        description: error instanceof ApiError ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function startChat() {
    if (!token) return;
    setIsBusy(true);

    try {
      const conversation = await openConversation(token, user.id);
      await refreshConversations();
      router.push(`/chat/${conversation.id}`);
    } catch (error) {
      toast({
        title: 'Could not open the chat',
        description: error instanceof ApiError ? error.message : 'Please try again.',
        variant: 'destructive',
      });
      setIsBusy(false);
    }
  }

  return (
    <li className="flex items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-secondary/60">
      <Avatar username={user.username} avatarUrl={user.avatarUrl} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{user.username}</p>
        <p className="truncate text-xs text-muted-foreground">{COPY[state]}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {isBusy ? (
          <div className="flex h-9 w-9 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <>
            {state === 'requestReceived' && (
              <>
                <PrimaryButton
                  onClick={() => run(() => acceptRequest(token!, user.id), `You accepted ${user.username}`)}
                  icon="accept"
                >
                  Accept
                </PrimaryButton>
                <GhostButton
                  onClick={() => run(() => declineRequest(token!, user.id))}
                  aria-label={`Decline ${user.username}`}
                >
                  Decline
                </GhostButton>
              </>
            )}

            {state === 'none' && (
              <PrimaryButton
                onClick={() => run(async () => (await followUser(token!, user.id)).relationship)}
                icon="follow"
              >
                Follow
              </PrimaryButton>
            )}

            {/* Following back raises a request like any other — they must accept
                it before the chat opens. */}
            {state === 'followsYou' && (
              <PrimaryButton
                onClick={() =>
                  run(
                    async () => (await followUser(token!, user.id)).relationship,
                    `Request sent to ${user.username}`
                  )
                }
                icon="follow"
              >
                Follow back
              </PrimaryButton>
            )}

            {state === 'requestSent' && (
              <GhostButton
                onClick={() => run(() => cancelRequest(token!, user.id))}
                icon="pending"
              >
                Requested
              </GhostButton>
            )}

            {state === 'following' && (
              <GhostButton
                onClick={() => run(() => unfollowUser(token!, user.id))}
                icon="following"
              >
                Following
              </GhostButton>
            )}

            {state === 'mutual' && (
              <>
                <button
                  onClick={() => void startChat()}
                  aria-label={`Message ${user.username}`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:bg-primary/90"
                >
                  <Icon name="message" size={18} />
                </button>
                <GhostButton
                  onClick={() => run(() => unfollowUser(token!, user.id))}
                  icon="following"
                >
                  Following
                </GhostButton>
              </>
            )}
          </>
        )}
      </div>
    </li>
  );
}

function PrimaryButton({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon?: 'follow' | 'accept';
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
    >
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

function GhostButton({
  onClick,
  icon,
  children,
  ...rest
}: {
  onClick: () => void;
  icon?: 'pending' | 'following';
  children: React.ReactNode;
  'aria-label'?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-lg border border-input px-3 text-xs font-semibold text-foreground transition hover:bg-secondary'
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}
