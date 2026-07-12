import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IConversation extends Document {
  /** Exactly two participants, always stored sorted. */
  participants: Types.ObjectId[];
  /**
   * The sorted pair joined by an underscore, e.g. "64a…_64b…".
   *
   * Two people opening a chat with each other at the same moment would otherwise
   * race and create two conversations. A unique key on the sorted pair makes
   * that impossible at the database level rather than hoping the application
   * checks first.
   */
  key: string;
  lastMessage?: {
    text: string;
    senderId: Types.ObjectId;
    createdAt: Date;
  };
  /**
   * "Delete chat for me" — one entry per participant who has cleared it.
   *
   * A timestamp, not a boolean, because clearing a chat is not the same as
   * leaving it: everything up to `at` is hidden from that user, but the thread
   * comes back the moment a *new* message arrives. Storing a flag would mean
   * either losing the chat forever or resurrecting the old history with it.
   */
  clearedAt: { user: Types.ObjectId; at: Date }[];
  updatedAt: Date;
  createdAt: Date;
}

const conversationSchema = new Schema<IConversation>(
  {
    participants: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      required: true,
      validate: {
        validator: (v: Types.ObjectId[]) => v.length === 2,
        message: 'A conversation must have exactly two participants',
      },
      index: true,
    },
    key: { type: String, required: true, unique: true },
    lastMessage: {
      text: String,
      senderId: { type: Schema.Types.ObjectId, ref: 'User' },
      createdAt: Date,
    },
    clearedAt: {
      type: [
        {
          _id: false,
          user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          at: { type: Date, required: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

// The inbox is sorted by recency, so index the sort key.
conversationSchema.index({ participants: 1, updatedAt: -1 });

/** Deterministic key for a pair of users, regardless of who initiates. */
export function conversationKey(a: string, b: string): string {
  return [a, b].sort().join('_');
}

const ConversationModel =
  (mongoose.models.Conversation as mongoose.Model<IConversation>) ||
  mongoose.model<IConversation>('Conversation', conversationSchema);

export default ConversationModel;
