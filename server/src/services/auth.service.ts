import bcrypt from 'bcryptjs';
import UserModel from '../models/User';
import { ApiError } from '../middleware/errorHandler';
import { signAuthToken } from '../lib/token';
import { toSelfDTO } from './user.service';
import type { AuthUser, SelfDTO } from '../types';

const BCRYPT_ROUNDS = 10;

export interface AuthResult {
  token: string;
  /** Includes avatarUrl, so the client can render your photo on first paint. */
  user: SelfDTO;
}

export async function register(params: {
  username: string;
  email: string;
  password: string;
}): Promise<AuthResult> {
  const existing = await UserModel.findOne({
    $or: [{ username: params.username }, { email: params.email.toLowerCase() }],
  });

  if (existing) {
    throw new ApiError(
      409,
      existing.username === params.username
        ? 'Username is already taken'
        : 'An account already exists with this email'
    );
  }

  const user = await UserModel.create({
    username: params.username,
    email: params.email.toLowerCase(),
    password: await bcrypt.hash(params.password, BCRYPT_ROUNDS),
  });

  // The JWT carries only id + username; the DTO additionally carries the avatar,
  // so a stale token never pins a stale photo.
  const identity: AuthUser = { id: String(user._id), username: user.username };
  return { token: signAuthToken(identity), user: toSelfDTO(user) };
}

export async function login(params: {
  identifier: string;
  password: string;
}): Promise<AuthResult> {
  const user = await UserModel.findOne({
    $or: [{ username: params.identifier }, { email: params.identifier.toLowerCase() }],
  });

  // Identical response for "no such user" and "wrong password". Telling an
  // attacker which accounts exist is free reconnaissance. The bcrypt compare
  // still runs on a dummy hash so the timing does not give it away either.
  const hash = user?.password ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
  const ok = await bcrypt.compare(params.password, hash);

  if (!user || !ok) {
    throw new ApiError(401, 'Incorrect username or password');
  }

  // The JWT carries only id + username; the DTO additionally carries the avatar,
  // so a stale token never pins a stale photo.
  const identity: AuthUser = { id: String(user._id), username: user.username };
  return { token: signAuthToken(identity), user: toSelfDTO(user) };
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const existing = await UserModel.exists({ username });
  return existing === null;
}
