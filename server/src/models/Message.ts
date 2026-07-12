import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IMessage extends Document {
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  /** Optional. A message needs TEXT or at least one ATTACHMENT. */
  text?: string;
  /**
   * Metadata is denormalised here rather than joined from `uploads` on every
   * read, so a thread costs one query and a message keeps its filename even if
   * the upload is later cleaned up.
   */
  attachments: {
    key: string;
    name: string;
    contentType: string;
    size: number;
  }[];
  /**
   * Legacy: the single-image field, from before attachments were a list. Kept so
   * messages already in the database keep rendering. Never written to any more.
   */
  imageKey?: string;
  /** Passed on from another chat. Shown as a label — a forward is not "yours". */
  forwarded: boolean;
  /**
   * "Delete for me" — users who have hidden this message. It stays in the
   * database and stays visible to everyone else. Deletion is asymmetric, so it
   * cannot be a boolean.
   */
  deletedFor: Types.ObjectId[];
  /**
   * "Delete for everyone" — the sender retracted it. The row survives as a
   * tombstone ("This message was deleted") rather than vanishing, because a
   * message silently disappearing from a conversation is worse than being told
   * it was withdrawn.
   */
  deletedForEveryone: boolean;
  /** True once the recipient had a live socket at broadcast time. */
  delivered: boolean;
  /** True once the recipient acknowledged reading it. */
  read: boolean;
  createdAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, trim: true, maxlength: 2000 },
    attachments: {
      type: [
        {
          _id: false,
          key: { type: String, required: true },
          name: { type: String, required: true },
          contentType: { type: String, required: true },
          size: { type: Number, required: true },
        },
      ],
      default: [],
    },
    imageKey: { type: String },
    forwarded: { type: Boolean, default: false },

    deletedFor: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    deletedForEveryone: { type: Boolean, default: false },

    // A one-to-one chat has exactly one recipient, so the arrays a group room
    // needed (deliveredTo / readBy) collapse into two booleans.
    delivered: { type: Boolean, default: false },
    read: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// An empty message is not a message. Enforced here as well as in the route, so
// it holds no matter which code path writes. A retracted message is exempt —
// that is exactly what a tombstone is.
messageSchema.pre('validate', function (next) {
  if (this.deletedForEveryone) {
    next();
    return;
  }

  const hasAttachment = this.attachments.length > 0 || Boolean(this.imageKey);

  if (!this.text?.trim() && !hasAttachment) {
    next(new Error('A message must have text or at least one attachment'));
    return;
  }
  next();
});

// Thread history: newest-first within one conversation.
messageSchema.index({ conversationId: 1, createdAt: -1 });
// Unread badge: "messages in this conversation, not from me, not read".
messageSchema.index({ conversationId: 1, senderId: 1, read: 1 });

const MessageModel =
  (mongoose.models.Message as mongoose.Model<IMessage>) ||
  mongoose.model<IMessage>('Message', messageSchema);

export default MessageModel;
