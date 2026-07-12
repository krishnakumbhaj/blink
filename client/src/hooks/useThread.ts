'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  deleteMessage as apiDeleteMessage,
  fetchConversation,
  fetchMessages,
  sendMessage as postMessage,
  type DeleteScope,
} from '@/lib/chat-api';
import { useAuth } from '@/context/AuthContext';
import { useChatContext, useMessageStream } from '@/context/ChatContext';
import type { ChatMessage, Conversation } from '@/types/chat';

const TYPING_IDLE_MS = 1500;

/**
 * One open conversation.
 *
 * The core rule, unchanged from the group build: **the socket is the single
 * source of truth for new messages.** `send()` POSTs and deliberately does not
 * touch local state — the message appears only when it round-trips back over
 * `message:new`. One render path for your messages and theirs, so there is no
 * optimistic copy to reconcile and no way to show a message that never saved.
 */
export function useThread(conversationId: string) {
  const { token, user } = useAuth();
  const { socket, typingIn } = useChatContext();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  // Load the thread whenever we switch conversation.
  useEffect(() => {
    if (!token || !conversationId) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    Promise.all([
      fetchConversation(token, conversationId),
      fetchMessages(token, conversationId),
    ])
      .then(([meta, history]) => {
        if (cancelled) return;
        setConversation(meta);
        setMessages(history);
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Could not open this conversation');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, conversationId]);

  /** Merge without duplicating — a reconnect can replay a message we already have. */
  useMessageStream(conversationId, (incoming) => {
    setMessages((prev) =>
      prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]
    );
  });

  // Read receipts and retractions for messages in THIS thread.
  useEffect(() => {
    if (!socket) return;

    const onStatus = (update: { conversationId: string; ids: string[]; read: boolean }) => {
      if (update.conversationId !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) => (update.ids.includes(m.id) ? { ...m, read: update.read } : m))
      );
    };

    /**
     * Someone retracted a message. Turn it into a tombstone in place rather than
     * removing it — a message vanishing without explanation reads as a bug, and
     * it silently reflows everything below it while you are looking at it.
     */
    const onDeleted = (payload: { conversationId: string; id: string }) => {
      if (payload.conversationId !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.id
            ? { ...m, deletedForEveryone: true, text: '', imageUrl: null }
            : m
        )
      );
    };

    socket.on('message:status', onStatus);
    socket.on('message:deleted', onDeleted);

    return () => {
      socket.off('message:status', onStatus);
      socket.off('message:deleted', onDeleted);
    };
  }, [socket, conversationId]);

  const stopTyping = useCallback(() => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (!isTypingRef.current) return;

    isTypingRef.current = false;
    socket?.emit('typing:stop', { conversationId });
  }, [socket, conversationId]);

  /** Call on each keystroke. Emits `typing:start` once, then auto-stops when idle. */
  const notifyTyping = useCallback(() => {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socket?.emit('typing:start', { conversationId });
    }

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  }, [socket, conversationId, stopTyping]);

  const send = useCallback(
    async (body: { text?: string; imageKey?: string }) => {
      if (!token) return;
      if (!body.text?.trim() && !body.imageKey) return;

      stopTyping();

      try {
        // The response body is deliberately ignored: the message reaches state
        // via `message:new`, which also proves the socket is alive.
        await postMessage(token, conversationId, body);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not send message');
        throw err;
      }
    },
    [token, conversationId, stopTyping]
  );

  /**
   * Delete one message.
   *
   * A delete-for-me is dropped from local state immediately — no socket event is
   * coming, because nobody else's view changed. A retraction is left alone here:
   * the server broadcasts `message:deleted` to both of us, and letting that one
   * path do the work means our screen and theirs update identically.
   */
  const removeMessage = useCallback(
    async (messageId: string, scope: DeleteScope) => {
      if (!token) return;

      try {
        await apiDeleteMessage(token, conversationId, messageId, scope);
        if (scope === 'me') {
          setMessages((prev) => prev.filter((m) => m.id !== messageId));
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not delete that message');
        throw err;
      }
    },
    [token, conversationId]
  );

  /** Tell the server we have seen everything they sent. Clears our unread badge. */
  const markRead = useCallback(() => {
    if (!socket || !user) return;

    const hasUnread = messages.some((m) => m.senderId !== user.id && !m.read);
    if (hasUnread) socket.emit('message:read', { conversationId });
  }, [socket, conversationId, messages, user]);

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, []);

  return {
    conversation,
    messages,
    isLoading,
    error,
    /** The other person's name, if they are typing right now. */
    typingUsername: typingIn[conversationId] ?? null,
    send,
    notifyTyping,
    markRead,
    removeMessage,
  };
}
