import { Router } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import {
  deleteConversation,
  deleteMessage,
  findOrCreateConversation,
  forwardMessage,
  getConversation,
  getMessages,
  listConversations,
  sendMessage,
} from '../services/conversation.service';
import {
  emitConversationDeleted,
  emitConversationUpdate,
  emitMessageDeleted,
  emitNewMessage,
} from '../sockets';
import { presence } from '../sockets/presence';

const openSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
});

const sendSchema = z
  .object({
    text: z.string().trim().max(2000, 'Message is too long').optional(),
    attachmentKeys: z.array(z.string().trim().min(1)).max(10).optional(),
  })
  // A message with neither text nor an attachment is not a message.
  .refine(
    (body) => Boolean(body.text?.trim()) || (body.attachmentKeys?.length ?? 0) > 0,
    { message: 'Message cannot be empty' }
  );

const historySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional(),
});

const forwardSchema = z.object({
  messageId: z.string().trim().min(1, 'messageId is required'),
  conversationIds: z
    .array(z.string().trim().min(1))
    .min(1, 'Pick at least one chat')
    .max(20, 'You can forward to at most 20 chats at once'),
});

/** Deliberately explicit — a destructive default is how accidents happen. */
const scopeSchema = z.object({
  scope: z.enum(['me', 'everyone'], {
    errorMap: () => ({ message: "scope must be 'me' or 'everyone'" }),
  }),
});

export function createConversationsRouter(io: Server): Router {
  const router = Router();

  router.use(requireAuth);

  /**
   * POST /api/conversations/forward — pass a message on to other chats.
   *
   * Declared BEFORE the `/:id` routes, or Express would read "forward" as a
   * conversation id.
   */
  router.post('/forward', async (req, res, next) => {
    try {
      const parsed = forwardSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);

      const results = await forwardMessage({
        messageId: parsed.data.messageId,
        targetConversationIds: parsed.data.conversationIds,
        meId: req.user!.id,
        isRecipientOnline: (userId) => presence.isOnline(userId),
      });

      for (const { message, participantIds } of results) {
        emitNewMessage(io, message, participantIds);
        await emitConversationUpdate(io, message.conversationId, participantIds);
      }

      res.status(201).json({ success: true, data: results.map((r) => r.message) });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/conversations — the inbox. */
  router.get('/', async (req, res, next) => {
    try {
      const conversations = await listConversations(req.user!.id);
      res.json({ success: true, data: conversations });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/conversations — open a chat with someone, creating it on first
   * contact. Rejects with 403 unless the two of you follow each other.
   */
  router.post('/', async (req, res, next) => {
    try {
      const parsed = openSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);

      const conversation = await findOrCreateConversation(req.user!.id, parsed.data.userId);
      res.status(201).json({ success: true, data: conversation });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/conversations/:id — one thread's metadata. */
  router.get('/:id', async (req, res, next) => {
    try {
      const conversation = await getConversation(req.params.id, req.user!.id);
      res.json({ success: true, data: conversation });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/conversations/:id/messages — chat history.
   * This is what makes messages survive a refresh: the client calls it on mount.
   */
  router.get('/:id/messages', async (req, res, next) => {
    try {
      const parsed = historySchema.safeParse(req.query);
      if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);

      const messages = await getMessages(req.params.id, req.user!.id, parsed.data);
      res.json({ success: true, data: messages });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/conversations/:id/messages — send a message.
   *
   * REST is the write path; Socket.io is the delivery path. We persist first,
   * then broadcast the saved record to both participants. Nothing is ever
   * delivered that is not already in the database, so a live client and a
   * refreshing client can never disagree.
   */
  router.post('/:id/messages', async (req, res, next) => {
    try {
      const parsed = sendSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);

      const meId = req.user!.id;

      // We need to know who the recipient is before we can ask whether they are
      // online, so the service resolves them and reports back.
      const conversation = await getConversation(req.params.id, meId);
      const recipientOnline = presence.isOnline(conversation.otherUser.id);

      const { message, participantIds } = await sendMessage({
        conversationId: req.params.id,
        meId,
        text: parsed.data.text,
        attachmentKeys: parsed.data.attachmentKeys,
        recipientOnline,
      });

      emitNewMessage(io, message, participantIds);
      await emitConversationUpdate(io, message.conversationId, participantIds);

      res.status(201).json({ success: true, data: message });
    } catch (err) {
      next(err);
    }
  });

  /**
   * DELETE /api/conversations/:id/messages/:messageId?scope=me|everyone
   *
   * `me` hides it from you alone. `everyone` retracts it — sender only.
   */
  router.delete('/:id/messages/:messageId', async (req, res, next) => {
    try {
      const parsed = scopeSchema.safeParse(req.query);
      if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);

      const { notifyOtherId, participantIds } = await deleteMessage({
        conversationId: req.params.id,
        messageId: req.params.messageId,
        meId: req.user!.id,
        scope: parsed.data.scope,
      });

      // Only a retraction changes what anyone else sees.
      if (notifyOtherId) {
        emitMessageDeleted(io, req.params.id, req.params.messageId, participantIds);
        await emitConversationUpdate(io, req.params.id, participantIds);
      }

      res.json({ success: true, data: { id: req.params.messageId, scope: parsed.data.scope } });
    } catch (err) {
      next(err);
    }
  });

  /**
   * DELETE /api/conversations/:id?scope=me|everyone
   *
   * `me` clears your copy — the thread returns if they message you again.
   * `everyone` destroys the conversation and every message in it, for both.
   */
  router.delete('/:id', async (req, res, next) => {
    try {
      const parsed = scopeSchema.safeParse(req.query);
      if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);

      const { participantIds, hard } = await deleteConversation({
        conversationId: req.params.id,
        meId: req.user!.id,
        scope: parsed.data.scope,
      });

      if (hard) {
        emitConversationDeleted(io, req.params.id, participantIds);
      }

      res.json({ success: true, data: { id: req.params.id, scope: parsed.data.scope } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
