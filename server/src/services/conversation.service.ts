import { Types } from 'mongoose';
import ConversationModel, { conversationKey, type IConversation } from '../models/Conversation';
import MessageModel, { type IMessage } from '../models/Message';
import UserModel from '../models/User';
import { ApiError } from '../middleware/errorHandler';
import { assertMutual, loadContext, toUserDTO } from './user.service';
import { isInlineImage, resolveAttachments, uploadUrl } from './upload.service';
import type { AttachmentDTO, ConversationDTO, DeleteScope, MessageDTO } from '../types';

/** Attachments, including any written under the old single-image field. */
function attachmentsOf(doc: IMessage): AttachmentDTO[] {
  const list: AttachmentDTO[] = doc.attachments.map((a) => ({
    key: a.key,
    url: uploadUrl(a.key),
    name: a.name,
    contentType: a.contentType,
    size: a.size,
    isImage: isInlineImage(a.contentType),
  }));

  // Messages saved before attachments were a list still carry `imageKey`. Read
  // it here so old threads keep rendering, rather than migrating the collection.
  if (doc.imageKey && list.length === 0) {
    list.push({
      key: doc.imageKey,
      url: uploadUrl(doc.imageKey),
      name: 'photo',
      contentType: 'image/jpeg',
      size: 0,
      isImage: true,
    });
  }

  return list;
}

export function toMessageDTO(doc: IMessage): MessageDTO {
  // A retracted message must not leak its content. The row may still hold the
  // original text until it is overwritten, so blank it here too — this is the
  // one place every message passes through on its way to a client.
  if (doc.deletedForEveryone) {
    return {
      id: String(doc._id),
      conversationId: String(doc.conversationId),
      senderId: String(doc.senderId),
      text: '',
      attachments: [],
      forwarded: false,
      deletedForEveryone: true,
      delivered: doc.delivered,
      read: doc.read,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  return {
    id: String(doc._id),
    conversationId: String(doc.conversationId),
    senderId: String(doc.senderId),
    text: doc.text ?? '',
    attachments: attachmentsOf(doc),
    forwarded: doc.forwarded,
    deletedForEveryone: false,
    delivered: doc.delivered,
    read: doc.read,
    createdAt: doc.createdAt.toISOString(),
  };
}

/** The inbox shows one line of text, so attachments need a stand-in. */
function previewOf(text: string | undefined, attachments: { contentType: string }[]): string {
  const trimmed = text?.trim();
  if (trimmed) return trimmed;

  if (attachments.length === 0) return '';

  const images = attachments.filter((a) => isInlineImage(a.contentType)).length;

  if (images === attachments.length) {
    return images === 1 ? '📷 Photo' : `📷 ${images} photos`;
  }
  if (images === 0) {
    return attachments.length === 1 ? '📎 File' : `📎 ${attachments.length} files`;
  }
  return `📎 ${attachments.length} attachments`;
}

/** When did this user last clear the chat? Null if they never have. */
function clearedAtFor(conversation: IConversation, meId: string): Date | null {
  const entry = conversation.clearedAt.find((c) => String(c.user) === meId);
  return entry?.at ?? null;
}

/**
 * The filter that hides what a given user has deleted.
 *
 * Two independent mechanisms, and history has to honour both: messages they hid
 * individually, and everything predating a chat-wide clear.
 */
function visibilityFilter(conversation: IConversation, meId: string): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    conversationId: conversation._id,
    deletedFor: { $ne: new Types.ObjectId(meId) },
  };

  const cleared = clearedAtFor(conversation, meId);
  if (cleared) filter.createdAt = { $gt: cleared };

  return filter;
}

/** The other participant, from `me`'s point of view. */
function otherParticipantId(conversation: IConversation, meId: string): string {
  const other = conversation.participants.find((id) => String(id) !== meId);
  if (!other) throw new ApiError(500, 'Conversation is missing a second participant');
  return String(other);
}

async function toConversationDTO(
  conversation: IConversation,
  meId: string
): Promise<ConversationDTO> {
  const otherId = otherParticipantId(conversation, meId);

  const [ctx, unreadCount] = await Promise.all([
    loadContext(meId),
    MessageModel.countDocuments({
      ...visibilityFilter(conversation, meId),
      senderId: { $ne: new Types.ObjectId(meId) },
      read: false,
    }),
  ]);

  const other = await UserModel.findById(otherId);
  if (!other) throw new ApiError(404, 'The other participant no longer exists');

  // If they cleared the chat, the preview must not resurrect a message from
  // before the clear — that is precisely what they asked to be rid of.
  const cleared = clearedAtFor(conversation, meId);
  const last = conversation.lastMessage;
  const showLast =
    last?.text && last.createdAt && (!cleared || last.createdAt > cleared) ? last : null;

  return {
    id: String(conversation._id),
    otherUser: toUserDTO(other, ctx),
    lastMessage: showLast
      ? {
          text: showLast.text,
          senderId: String(showLast.senderId),
          createdAt: showLast.createdAt.toISOString(),
        }
      : null,
    unreadCount,
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

/** Loads a conversation and proves you belong in it. */
export async function getConversationOrThrow(
  conversationId: string,
  meId: string
): Promise<IConversation> {
  if (!Types.ObjectId.isValid(conversationId)) {
    throw new ApiError(400, 'Invalid conversation id');
  }

  const conversation = await ConversationModel.findById(conversationId);
  if (!conversation) throw new ApiError(404, 'Conversation not found');

  const isParticipant = conversation.participants.some((id) => String(id) === meId);
  // 404, not 403 — confirming a conversation exists that you are not part of
  // tells you something you have no business knowing.
  if (!isParticipant) throw new ApiError(404, 'Conversation not found');

  return conversation;
}

/** The inbox, most recent first. */
export async function listConversations(meId: string): Promise<ConversationDTO[]> {
  const conversations = await ConversationModel.find({ participants: new Types.ObjectId(meId) })
    .sort({ updatedAt: -1 })
    .limit(50)
    .exec();

  // A chat you cleared stays gone until they say something new. It reappears on
  // the next message rather than being deleted outright, because "delete chat"
  // means "I am done with this history", not "block this person".
  const visible = conversations.filter((conversation) => {
    const cleared = clearedAtFor(conversation, meId);
    if (!cleared) return true;

    const last = conversation.lastMessage;
    return Boolean(last?.createdAt && last.createdAt > cleared);
  });

  return Promise.all(visible.map((c) => toConversationDTO(c, meId)));
}

/**
 * Find the conversation with someone, creating it on first contact.
 *
 * Two people tapping "message" on each other simultaneously would race, so the
 * insert relies on the unique key and treats a duplicate-key error as "someone
 * beat me to it" rather than a failure.
 */
export async function findOrCreateConversation(
  meId: string,
  otherId: string
): Promise<ConversationDTO> {
  await assertMutual(meId, otherId);

  const key = conversationKey(meId, otherId);
  const participants = [new Types.ObjectId(meId), new Types.ObjectId(otherId)].sort((a, b) =>
    String(a).localeCompare(String(b))
  );

  let conversation = await ConversationModel.findOne({ key });

  if (!conversation) {
    try {
      conversation = await ConversationModel.create({ key, participants });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        conversation = await ConversationModel.findOne({ key });
      } else {
        throw err;
      }
    }
  }

  if (!conversation) throw new ApiError(500, 'Could not open the conversation');

  return toConversationDTO(conversation, meId);
}

export async function getConversation(
  conversationId: string,
  meId: string
): Promise<ConversationDTO> {
  const conversation = await getConversationOrThrow(conversationId, meId);
  return toConversationDTO(conversation, meId);
}

/** Thread history, oldest-first so the client renders top-to-bottom. */
export async function getMessages(
  conversationId: string,
  meId: string,
  params: { limit: number; before?: string }
): Promise<MessageDTO[]> {
  const conversation = await getConversationOrThrow(conversationId, meId);

  const filter = visibilityFilter(conversation, meId);

  if (params.before) {
    // A cursor and a chat-clear both constrain createdAt, so they have to be
    // merged rather than one overwriting the other.
    const existing = (filter.createdAt as Record<string, Date>) ?? {};
    filter.createdAt = { ...existing, $lt: new Date(params.before) };
  }

  const docs = await MessageModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(params.limit)
    .exec();

  return docs.reverse().map(toMessageDTO);
}

export interface SendResult {
  message: MessageDTO;
  /** Both participants, so the socket layer knows who to notify. */
  participantIds: string[];
  otherId: string;
}

export async function sendMessage(params: {
  conversationId: string;
  meId: string;
  text?: string;
  /** Upload keys, in the order they should appear. */
  attachmentKeys?: string[];
  /** Whether the recipient has a live socket right now. */
  recipientOnline: boolean;
}): Promise<SendResult> {
  const conversation = await getConversationOrThrow(params.conversationId, params.meId);
  const otherId = otherParticipantId(conversation, params.meId);

  // Re-checked on every send, not just at creation. If they unfollow you, an
  // existing thread must not remain a back door.
  await assertMutual(params.meId, otherId);

  // Resolves the keys AND proves you own every one of them.
  const attachments = await resolveAttachments(params.attachmentKeys ?? [], params.meId);

  const doc = await MessageModel.create({
    conversationId: conversation._id,
    senderId: new Types.ObjectId(params.meId),
    text: params.text,
    attachments: attachments.map((a) => ({
      key: a.key,
      name: a.name,
      contentType: a.contentType,
      size: a.size,
    })),
    delivered: params.recipientOnline,
    read: false,
  });

  conversation.lastMessage = {
    text: previewOf(doc.text, attachments),
    senderId: doc.senderId,
    createdAt: doc.createdAt,
  };
  await conversation.save();

  return {
    message: toMessageDTO(doc),
    participantIds: conversation.participants.map(String),
    otherId,
  };
}

/** Marks everything the other person sent in this thread as read. */
export async function markThreadRead(
  conversationId: string,
  meId: string
): Promise<{ ids: string[]; otherId: string }> {
  const conversation = await getConversationOrThrow(conversationId, meId);
  const otherId = otherParticipantId(conversation, meId);

  const unread = await MessageModel.find({
    conversationId: conversation._id,
    senderId: { $ne: new Types.ObjectId(meId) },
    read: false,
  })
    .select('_id')
    .exec();

  const ids = unread.map((doc) => String(doc._id));
  if (ids.length === 0) return { ids: [], otherId };

  await MessageModel.updateMany({ _id: { $in: unread.map((d) => d._id) } }, { $set: { read: true } });

  return { ids, otherId };
}

/** Marks a delivered flag once the recipient's socket has actually received it. */
export async function markDelivered(messageId: string): Promise<void> {
  await MessageModel.updateOne({ _id: messageId }, { $set: { delivered: true } });
}

export async function getConversationDTOFor(
  conversationId: string,
  viewerId: string
): Promise<ConversationDTO> {
  const conversation = await ConversationModel.findById(conversationId);
  if (!conversation) throw new ApiError(404, 'Conversation not found');
  return toConversationDTO(conversation, viewerId);
}

// ------------------------------------------------------------------ forwarding

export interface ForwardResult {
  message: MessageDTO;
  participantIds: string[];
}

/**
 * Pass a message on to one or more other chats.
 *
 * The attachments are **re-used, not re-uploaded**. Two reasons:
 *
 * 1. The bytes are already in the database. Copying an 8 MB file for every
 *    forward would grow storage without adding a single new pixel.
 * 2. `resolveAttachments` refuses keys you do not own — and a forwarded file
 *    belongs to whoever originally sent it, not to you. That check exists to stop
 *    you attaching a stranger's upload key you guessed at. It does not apply
 *    here: the attachment metadata is copied from a message you are *provably*
 *    allowed to read, so authorisation has already been established. Running the
 *    ownership check would reject a legitimate forward.
 *
 * A forward is marked as such. It is a quotation, not something you wrote.
 */
export async function forwardMessage(params: {
  messageId: string;
  targetConversationIds: string[];
  meId: string;
  isRecipientOnline: (userId: string) => boolean;
}): Promise<ForwardResult[]> {
  if (!Types.ObjectId.isValid(params.messageId)) {
    throw new ApiError(400, 'Invalid message id');
  }

  const source = await MessageModel.findById(params.messageId);
  if (!source) throw new ApiError(404, 'Message not found');

  // Proves you may READ the source. Throws 404 if you are not in its thread.
  await getConversationOrThrow(String(source.conversationId), params.meId);

  if (source.deletedForEveryone) {
    throw new ApiError(410, 'That message was deleted');
  }
  if (source.deletedFor.some((id) => String(id) === params.meId)) {
    throw new ApiError(404, 'Message not found');
  }

  const attachments = source.attachments.map((a) => ({
    key: a.key,
    name: a.name,
    contentType: a.contentType,
    size: a.size,
  }));

  const results: ForwardResult[] = [];

  for (const targetId of params.targetConversationIds) {
    // Each target is authorised independently: you must be in it, AND still be
    // mutuals with the other person. Forwarding is not a way around that.
    const target = await getConversationOrThrow(targetId, params.meId);
    const otherId = otherParticipantId(target, params.meId);
    await assertMutual(params.meId, otherId);

    const doc = await MessageModel.create({
      conversationId: target._id,
      senderId: new Types.ObjectId(params.meId),
      text: source.text,
      attachments,
      forwarded: true,
      delivered: params.isRecipientOnline(otherId),
      read: false,
    });

    target.lastMessage = {
      text: previewOf(doc.text, attachments),
      senderId: doc.senderId,
      createdAt: doc.createdAt,
    };
    await target.save();

    results.push({
      message: toMessageDTO(doc),
      participantIds: target.participants.map(String),
    });
  }

  return results;
}

// ------------------------------------------------------------------ deletion

export interface DeleteMessageResult {
  /** Only the other participant needs telling, and only for a retraction. */
  notifyOtherId: string | null;
  participantIds: string[];
}

/**
 * Delete one message.
 *
 * `me`       — hidden from you. It stays exactly where it was for them.
 * `everyone` — retracted. Sender only. Content is destroyed and replaced with a
 *              tombstone that both of you can see.
 *
 * Only the *sender* may retract. Letting a recipient delete-for-everyone would
 * mean anyone could erase what you said to them, which is not a delete button —
 * it is a censorship button.
 */
export async function deleteMessage(params: {
  conversationId: string;
  messageId: string;
  meId: string;
  scope: DeleteScope;
}): Promise<DeleteMessageResult> {
  const conversation = await getConversationOrThrow(params.conversationId, params.meId);

  if (!Types.ObjectId.isValid(params.messageId)) {
    throw new ApiError(400, 'Invalid message id');
  }

  const message = await MessageModel.findOne({
    _id: params.messageId,
    conversationId: conversation._id,
  });

  if (!message) throw new ApiError(404, 'Message not found');

  const participantIds = conversation.participants.map(String);
  const otherId = participantIds.find((id) => id !== params.meId) ?? null;

  if (params.scope === 'everyone') {
    if (String(message.senderId) !== params.meId) {
      throw new ApiError(403, 'You can only delete your own messages for everyone');
    }

    if (message.deletedForEveryone) {
      return { notifyOtherId: null, participantIds };
    }

    // Actually destroy the content — a tombstone that still holds the text in
    // the database is not a deletion, it is a rename.
    message.deletedForEveryone = true;
    message.text = undefined;
    message.imageKey = undefined;
    await message.save();

    await refreshLastMessage(conversation);

    return { notifyOtherId: otherId, participantIds };
  }

  await MessageModel.updateOne(
    { _id: message._id },
    { $addToSet: { deletedFor: new Types.ObjectId(params.meId) } }
  );

  // Nobody else's view changed, so nobody else is told.
  return { notifyOtherId: null, participantIds };
}

export interface DeleteConversationResult {
  participantIds: string[];
  otherId: string | null;
  /** True when the whole thread was destroyed for both sides. */
  hard: boolean;
}

/**
 * Delete a whole chat.
 *
 * `me`       — clears YOUR copy. The thread leaves your inbox and its history is
 *              hidden from you, but it is untouched for them, and it comes back
 *              for you if they send something new.
 * `everyone` — destroys the conversation and every message in it, for both of
 *              you, permanently. Either participant may do this.
 */
export async function deleteConversation(params: {
  conversationId: string;
  meId: string;
  scope: DeleteScope;
}): Promise<DeleteConversationResult> {
  const conversation = await getConversationOrThrow(params.conversationId, params.meId);

  const participantIds = conversation.participants.map(String);
  const otherId = participantIds.find((id) => id !== params.meId) ?? null;

  if (params.scope === 'everyone') {
    await MessageModel.deleteMany({ conversationId: conversation._id });
    await ConversationModel.deleteOne({ _id: conversation._id });

    return { participantIds, otherId, hard: true };
  }

  // Upsert my clear marker. Re-clearing simply moves the timestamp forward.
  const meObjectId = new Types.ObjectId(params.meId);
  const already = conversation.clearedAt.some((c) => String(c.user) === params.meId);

  if (already) {
    await ConversationModel.updateOne(
      { _id: conversation._id, 'clearedAt.user': meObjectId },
      { $set: { 'clearedAt.$.at': new Date() } }
    );
  } else {
    await ConversationModel.updateOne(
      { _id: conversation._id },
      { $push: { clearedAt: { user: meObjectId, at: new Date() } } }
    );
  }

  return { participantIds, otherId, hard: false };
}

/**
 * Recompute the inbox preview after a retraction.
 *
 * Without this, deleting your last message for everyone leaves its text sitting
 * in both inboxes — the one place it is most visible.
 */
async function refreshLastMessage(conversation: IConversation): Promise<void> {
  const latest = await MessageModel.findOne({
    conversationId: conversation._id,
    deletedForEveryone: false,
  })
    .sort({ createdAt: -1 })
    .exec();

  conversation.lastMessage = latest
    ? {
        text: previewOf(latest.text, attachmentsOf(latest)),
        senderId: latest.senderId,
        createdAt: latest.createdAt,
      }
    : undefined;

  await conversation.save();
}
