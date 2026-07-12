import type { Server, Socket } from 'socket.io';
import { presence, userRoom } from './presence';
import {
  getConversationOrThrow,
  getConversationDTOFor,
  markThreadRead,
} from '../services/conversation.service';
import type { ConversationDTO, MessageDTO } from '../types';

/**
 * Delivery is scoped, not broadcast.
 *
 * Every socket joins a room named after its user, so a message reaches exactly
 * the two people in the conversation — across all of their open tabs — and
 * nobody else. There is no room the whole app shares.
 */

function broadcastPresence(io: Server): void {
  io.emit('presence:update', { online: presence.list() });
}

/**
 * The inbox row differs per viewer — unreadCount is "unread *by you*" — so the
 * two participants cannot be sent the same payload.
 */
export async function emitConversationUpdate(
  io: Server,
  conversationId: string,
  participantIds: string[]
): Promise<void> {
  await Promise.all(
    participantIds.map(async (viewerId) => {
      try {
        const dto: ConversationDTO = await getConversationDTOFor(conversationId, viewerId);
        io.to(userRoom(viewerId)).emit('conversation:update', dto);
      } catch (err) {
        console.error('[socket] conversation:update failed for', viewerId, err);
      }
    })
  );
}

/** Called by the REST send route once the message is safely persisted. */
export function emitNewMessage(
  io: Server,
  message: MessageDTO,
  participantIds: string[]
): void {
  for (const id of participantIds) {
    io.to(userRoom(id)).emit('message:new', message);
  }
}

/**
 * A message was retracted. Sent to BOTH sides — the sender's other tabs need it
 * too, or the message stays on screen in the window they didn't delete it from.
 *
 * A "delete for me" never reaches here: nobody else's view changed.
 */
export function emitMessageDeleted(
  io: Server,
  conversationId: string,
  messageId: string,
  participantIds: string[]
): void {
  for (const id of participantIds) {
    io.to(userRoom(id)).emit('message:deleted', { conversationId, id: messageId });
  }
}

/** The whole thread was destroyed for both sides. */
export function emitConversationDeleted(
  io: Server,
  conversationId: string,
  participantIds: string[]
): void {
  for (const id of participantIds) {
    io.to(userRoom(id)).emit('conversation:deleted', { conversationId });
  }
}

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as { id: string; username: string };

    void socket.join(userRoom(user.id));

    const cameOnline = presence.add(user.id, user.username, socket.id);
    console.log(`[socket] ${user.username} connected (${socket.id})`);

    // Always send the roster to the joiner; only tell everyone else if this is
    // genuinely a new user rather than a second tab.
    if (cameOnline) broadcastPresence(io);
    else socket.emit('presence:update', { online: presence.list() });

    /**
     * Typing is relayed, not stored.
     *
     * The server holds no typing state at all: it forwards the event to the one
     * other participant and forgets. The client expires the indicator on a timer,
     * so a browser that dies mid-keystroke cannot leave someone stuck as
     * "typing…" forever — which is exactly the bug that server-held state causes.
     */
    const relayTyping = async (conversationId: string, isTyping: boolean) => {
      try {
        const conversation = await getConversationOrThrow(conversationId, user.id);
        const otherId = conversation.participants.map(String).find((id) => id !== user.id);
        if (!otherId) return;

        io.to(userRoom(otherId)).emit('typing:update', {
          conversationId,
          username: user.username,
          isTyping,
        });
      } catch {
        /* not a participant, or the conversation is gone — nothing to relay */
      }
    };

    socket.on('typing:start', (payload: { conversationId: string }) => {
      if (payload?.conversationId) void relayTyping(payload.conversationId, true);
    });

    socket.on('typing:stop', (payload: { conversationId: string }) => {
      if (payload?.conversationId) void relayTyping(payload.conversationId, false);
    });

    socket.on('message:read', async (payload: { conversationId: string }) => {
      try {
        if (!payload?.conversationId) return;

        const { ids, otherId } = await markThreadRead(payload.conversationId, user.id);
        if (ids.length === 0) return;

        // The sender needs to see their ticks turn; we need our badge cleared.
        for (const id of [user.id, otherId]) {
          io.to(userRoom(id)).emit('message:status', {
            conversationId: payload.conversationId,
            ids,
            read: true,
          });
        }

        await emitConversationUpdate(io, payload.conversationId, [user.id, otherId]);
      } catch (err) {
        console.error('[socket] message:read failed:', err);
        socket.emit('chat:error', { message: 'Could not update read status' });
      }
    });

    // A socket-level error must never take the process down.
    socket.on('error', (err) => {
      console.error(`[socket] error on ${socket.id}:`, err.message);
    });

    socket.on('disconnect', (reason) => {
      console.log(`[socket] ${user.username} disconnected (${reason})`);
      const wentOffline = presence.remove(user.id, socket.id);
      if (wentOffline) broadcastPresence(io);
    });
  });
}
