import mongoose, { Schema, Document, Types } from 'mongoose';
import crypto from 'crypto';

/**
 * An image, stored in MongoDB.
 *
 * Not on disk, because Render's free tier has an ephemeral filesystem and every
 * deploy would wipe every avatar. Not on S3/Cloudinary, because that is another
 * account to create and another set of credentials to leak. Images live with the
 * data they belong to, and survive a redeploy for free.
 *
 * The trade-off is that MongoDB is not a CDN. At 3 MB a file and a handful of
 * users that is irrelevant; at real scale you would move these to object storage
 * and keep only the key here.
 */
export interface IUpload extends Document {
  /** Unguessable public handle. The URL is the capability — see below. */
  key: string;
  ownerId: Types.ObjectId;
  data: Buffer;
  contentType: string;
  /** The original filename, so a document downloads as "invoice.pdf". */
  name: string;
  size: number;
  createdAt: Date;
}

const uploadSchema = new Schema<IUpload>(
  {
    key: { type: String, required: true, unique: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    data: { type: Buffer, required: true },
    contentType: { type: String, required: true },
    name: { type: String, required: true, default: 'file' },
    size: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

/**
 * 128 bits of randomness, not the ObjectId.
 *
 * `GET /api/uploads/:key` is unauthenticated — it has to be, because an <img
 * src> cannot carry an Authorization header. So the URL itself is the
 * credential, which means it must be unguessable. ObjectIds are partly a
 * timestamp and a counter; knowing one lets you guess its neighbours. A random
 * key does not.
 */
export function generateUploadKey(): string {
  return crypto.randomBytes(16).toString('hex');
}

const UploadModel =
  (mongoose.models.Upload as mongoose.Model<IUpload>) ||
  mongoose.model<IUpload>('Upload', uploadSchema);

export default UploadModel;
