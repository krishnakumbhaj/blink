import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IUser extends Document {
  username: string;
  email: string;
  /** bcrypt hash — never the plaintext, and never sent to a client. */
  password: string;
  /** Upload key for their profile photo. Absent means "fall back to initials". */
  avatarKey?: string;
  /** Users this person follows. */
  following: Types.ObjectId[];
  /** Users who follow this person. Denormalised so a profile needs one read. */
  followers: Types.ObjectId[];
  createdAt: Date;
}

const userSchema = new Schema<IUser>({
  username: {
    type: String,
    required: [true, 'Username is required'],
    trim: true,
    unique: true,
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    unique: true,
    match: [/\S+@\S+\.\S+/, 'Please enter a valid email'],
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
  },
  avatarKey: { type: String },
  following: { type: [Schema.Types.ObjectId], ref: 'User', default: [], index: true },
  followers: { type: [Schema.Types.ObjectId], ref: 'User', default: [], index: true },
  createdAt: { type: Date, default: Date.now },
});

// No extra index on `username` — `unique: true` above already creates one, and
// declaring it twice makes Mongoose warn about a duplicate.

const UserModel =
  (mongoose.models.User as mongoose.Model<IUser>) ||
  mongoose.model<IUser>('User', userSchema);

export default UserModel;
