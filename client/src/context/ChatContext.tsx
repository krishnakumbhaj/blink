'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { CHAT_SERVER_URL, fetchConversations, fetchRequests } from '@/lib/chat-api';
import { useAuth } from '@/context/AuthContext';
import type { ChatMessage, ChatUser, ConnectionStatus, Conversation } from '@/types/chat';

/** How long a typing indicator survives without a refresh from the server. */
const TYPING_EXPIRY_MS = 4000;

interface ChatContextValue {
  socket: Socket | null;
  status: ConnectionStatus;
  conversations: Conversation[];
  /** People waiting on your decision. Drives the badge on the People button. */
  requests: ChatUser[];
  /** Ids of everyone currently online. */
  onlineIds: Set<string>;
  /** conversationId -> the username typing in it. */
  typingIn: Record<string, string>;
  isLoading: boolean;
  error: string | null;
  refreshConversations: () => Promise<void>;
  refreshRequests: () => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/**
 * Owns the single socket for the whole app.
 *
 * One connection, mounted at the /chat layout, shared by the sidebar and every
 * thread. Opening a socket per component would mean N connections per user and
 * duplicate event handling — the inbox and the open thread both react to the
 * same `message:new`.
 */
export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { token, signOut } = useAuth();
  const router = useRouter();

  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [requests, setRequests] = useState<ChatUser[]>([]);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [typingIn, setTypingIn] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const refreshConversations = useCallback(async () => {
    if (!token) return;
    try {
      setConversations(await fetchConversations(token));
    } catch {
      /* a stale inbox is not worth a hard error */
    }
  }, [token]);

  const refreshRequests = useCallback(async () => {
    if (!token) return;
    try {
      setRequests(await fetchRequests(token));
    } catch {
      /* likewise */
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    let active: Socket | null = null;
    const timers = typingTimers.current;

    async function connect(authToken: string) {
      try {
        setStatus('connecting');
        setError(null);

        const [inbox, pending] = await Promise.all([
          fetchConversations(authToken),
          fetchRequests(authToken),
        ]);
        if (cancelled) return;

        setConversations(inbox);
        setRequests(pending);
        setIsLoading(false);

        active = io(CHAT_SERVER_URL, {
          auth: { token: authToken },
          transports: ['websocket', 'polling'],
        });
        setSocket(active);

        active.on('connect', () => {
          setStatus('connected');
          setError(null);
        });

        /**
         * The inbox row is replaced wholesale and floated to the top. The server
         * computes it per-viewer (unreadCount is "unread *by you*"), so we never
         * try to derive it locally.
         */
        active.on('conversation:update', (conversation: Conversation) => {
          setConversations((prev) => [
            conversation,
            ...prev.filter((c) => c.id !== conversation.id),
          ]);
        });

        // A message can arrive for a thread that is not open. The inbox still
        // has to move, and that is what conversation:update above is for — so
        // there is deliberately nothing to do here at the provider level.

        /**
         * The other person destroyed the thread for both of us. Drop it from the
         * inbox, and if we happen to be *looking* at it, get out — otherwise the
         * open thread would sit there 404ing on every action.
         */
        active.on('conversation:deleted', ({ conversationId }: { conversationId: string }) => {
          setConversations((prev) => prev.filter((c) => c.id !== conversationId));

          if (window.location.pathname === `/chat/${conversationId}`) {
            router.replace('/chat');
          }
        });

        active.on('presence:update', (payload: { online: { id: string }[] }) => {
          setOnlineIds(new Set(payload.online.map((u) => u.id)));
        });

        /**
         * Typing expires on a timer here, on the client.
         *
         * The server holds no typing state at all — it relays and forgets. If it
         * kept state, a browser that died mid-keystroke would leave the other
         * person stuck as "typing…" forever. Expiring locally means the worst
         * case is a stale indicator for four seconds.
         */
        active.on(
          'typing:update',
          ({ conversationId, username, isTyping }: { conversationId: string; username: string; isTyping: boolean }) => {
            clearTimeout(timers[conversationId]);

            if (!isTyping) {
              setTypingIn((prev) => {
                const next = { ...prev };
                delete next[conversationId];
                return next;
              });
              return;
            }

            setTypingIn((prev) => ({ ...prev, [conversationId]: username }));

            timers[conversationId] = setTimeout(() => {
              setTypingIn((prev) => {
                const next = { ...prev };
                delete next[conversationId];
                return next;
              });
            }, TYPING_EXPIRY_MS);
          }
        );

        // Someone asked to follow you. Bump the badge without a refresh.
        active.on('follow:request', () => {
          void refreshRequests();
        });

        /**
         * A relationship changed — they accepted, declined, followed back, or
         * unfollowed. Any of those can unlock or lock a chat, or clear a request.
         * Re-pulling both lists is cheaper than reasoning about which happened.
         */
        active.on('follow:update', () => {
          void refreshConversations();
          void refreshRequests();
        });

        active.on('chat:error', (payload: { message: string }) => setError(payload.message));

        active.on('connect_error', (err: Error) => {
          setStatus('reconnecting');

          // A rejected handshake means the token is dead. There is no refresh
          // endpoint, so retrying forever with a credential we know is bad is
          // pointless — end the session honestly.
          if (/token|auth/i.test(err.message)) {
            setError('Your session expired. Please sign in again.');
            signOut();
            return;
          }
          setError('Lost connection. Retrying…');
        });

        active.on('disconnect', (reason) => {
          // An explicit client-side disconnect is us unmounting, not a failure.
          if (reason === 'io client disconnect') return;
          setStatus('reconnecting');
        });

        // We were offline and may have missed things. Re-pull to close the gap.
        active.io.on('reconnect', () => {
          void refreshConversations();
          void refreshRequests();
        });
      } catch (err) {
        if (cancelled) return;
        setIsLoading(false);
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Could not connect to the chat');
      }
    }

    void connect(token);

    return () => {
      cancelled = true;
      Object.values(timers).forEach(clearTimeout);
      active?.removeAllListeners();
      active?.disconnect();
      setSocket(null);
    };
  }, [token, signOut, router, refreshConversations, refreshRequests]);

  const value = useMemo(
    () => ({
      socket,
      status,
      conversations,
      requests,
      onlineIds,
      typingIn,
      isLoading,
      error,
      refreshConversations,
      refreshRequests,
    }),
    [
      socket,
      status,
      conversations,
      requests,
      onlineIds,
      typingIn,
      isLoading,
      error,
      refreshConversations,
      refreshRequests,
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChatContext must be used inside a ChatProvider');
  return context;
}

/** Convenience for the thread: the messages of one conversation arriving live. */
export function useMessageStream(
  conversationId: string | null,
  onMessage: (message: ChatMessage) => void
) {
  const { socket } = useChatContext();
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    if (!socket || !conversationId) return;

    const onNew = (message: ChatMessage) => {
      if (message.conversationId !== conversationId) return;
      handler.current(message);
    };

    socket.on('message:new', onNew);
    return () => {
      socket.off('message:new', onNew);
    };
  }, [socket, conversationId]);
}
