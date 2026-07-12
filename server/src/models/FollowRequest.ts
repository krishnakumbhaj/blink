import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * A pending "X wants to follow Y".
 *
 * Accepted follows do NOT live here — they move into User.following /
 * User.followers. This collection only ever holds requests awaiting a decision,
 * so it stays small and "do I have any requests?" is one indexed lookup.
 */
export interface IFollowRequest extends Document {
  from: Types.ObjectId;
  to: Types.ObjectId;
  createdAt: Date;
}

const followRequestSchema = new Schema<IFollowRequest>(
  {
    from: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    to: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// One pending request per direction. Tapping "Follow" twice must not create two.
followRequestSchema.index({ from: 1, to: 1 }, { unique: true });
// "Show me my incoming requests", newest first.
followRequestSchema.index({ to: 1, createdAt: -1 });

const FollowRequestModel =
  (mongoose.models.FollowRequest as mongoose.Model<IFollowRequest>) ||
  mongoose.model<IFollowRequest>('FollowRequest', followRequestSchema);

export default FollowRequestModel;
