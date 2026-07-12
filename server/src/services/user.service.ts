import { Types } from 'mongoose';
import UserModel, { type IUser } from '../models/User';
import FollowRequestModel from '../models/FollowRequest';
import { ApiError } from '../middleware/errorHandler';
import { assertOwnedImage, uploadUrl } from './upload.service';
import type { SelfDTO, UserDTO } from '../types';

/**
 * Everything needed to describe other people from `me`'s point of view, fetched
 * once. Building a list of 20 users otherwise means 40 extra queries.
 */
export interface RelationshipContext {
  me: IUser;
  /** Ids I have a pending request TO. */
  outgoing: Set<string>;
  /** Ids that have a pending request TO me. */
  incoming: Set<string>;
}

export async function loadContext(meId: string): Promise<RelationshipContext> {
  const me = await getUserOrThrow(meId);

  const [outgoing, incoming] = await Promise.all([
    FollowRequestModel.find({ from: me._id }).select('to').lean(),
    FollowRequestModel.find({ to: me._id }).select('from').lean(),
  ]);

  return {
    me,
    outgoing: new Set(outgoing.map((r) => String(r.to))),
    incoming: new Set(incoming.map((r) => String(r.from))),
  };
}

/** Describes `other` from `me`'s point of view. */
export function toUserDTO(other: IUser, ctx: RelationshipContext): UserDTO {
  const otherId = String(other._id);
  const meId = String(ctx.me._id);

  const isFollowing = ctx.me.following.some((id) => String(id) === otherId);
  const followsYou = other.following.some((id) => String(id) === meId);

  return {
    id: otherId,
    username: other.username,
    avatarUrl: other.avatarKey ? uploadUrl(other.avatarKey) : null,
    isFollowing,
    followsYou,
    isMutual: isFollowing && followsYou,
    requestSent: ctx.outgoing.has(otherId),
    requestReceived: ctx.incoming.has(otherId),
  };
}

/** You, as returned by the auth endpoints. */
export function toSelfDTO(user: IUser): SelfDTO {
  return {
    id: String(user._id),
    username: user.username,
    avatarUrl: user.avatarKey ? uploadUrl(user.avatarKey) : null,
  };
}

/** Set or clear your profile photo. */
export async function setAvatar(meId: string, avatarKey: string | null): Promise<SelfDTO> {
  if (avatarKey) {
    // You may only point at an image you uploaded yourself — and it must
    // actually be an image, not a PDF that happens to be named .png.
    await assertOwnedImage(avatarKey, meId);
  }

  await UserModel.updateOne(
    { _id: meId },
    avatarKey ? { $set: { avatarKey } } : { $unset: { avatarKey: 1 } }
  );

  return toSelfDTO(await getUserOrThrow(meId));
}

/** One-off convenience when you only need a single user. */
export async function describeUser(meId: string, otherId: string): Promise<UserDTO> {
  const [ctx, other] = await Promise.all([loadContext(meId), getUserOrThrow(otherId)]);
  return toUserDTO(other, ctx);
}

export async function getUserOrThrow(id: string): Promise<IUser> {
  if (!Types.ObjectId.isValid(id)) throw new ApiError(400, 'Invalid user id');

  const user = await UserModel.findById(id);
  if (!user) throw new ApiError(404, 'User not found');

  return user;
}

/**
 * The two people must follow each other — accepted, not pending. Checked on
 * every send, not just when the conversation is created, so unfollowing someone
 * closes an existing thread rather than leaving a back door.
 */
export async function assertMutual(meId: string, otherId: string): Promise<void> {
  const [me, other] = await Promise.all([getUserOrThrow(meId), getUserOrThrow(otherId)]);

  const isFollowing = me.following.some((id) => String(id) === otherId);
  const followsYou = other.following.some((id) => String(id) === meId);

  if (!isFollowing || !followsYou) {
    throw new ApiError(403, 'You can only message people who follow you back');
  }
}

/** Case-insensitive prefix search on username, excluding yourself. */
export async function searchUsers(meId: string, query: string): Promise<UserDTO[]> {
  const ctx = await loadContext(meId);

  // Escape the query — someone typing ".*" must not have it executed as a regex.
  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const users = await UserModel.find({
    _id: { $ne: ctx.me._id },
    username: { $regex: `^${safe}`, $options: 'i' },
  })
    .limit(20)
    .exec();

  return users.map((user) => toUserDTO(user, ctx));
}

export interface FollowResult {
  relationship: UserDTO;
  /**
   * Always false. Kept in the response shape so clients need not special-case
   * it, and so reintroducing an auto-accept later would not be a breaking change.
   */
  accepted: boolean;
}

/**
 * Ask to follow someone. ALWAYS creates a pending request.
 *
 * Every follow needs approval, in both directions — including following back
 * someone who already follows you. That means starting a chat is a four-step
 * handshake:
 *
 *   ana requests → ben accepts → ben requests → ana accepts → mutual → chat
 *
 * This is deliberate and was chosen over auto-accepting the follow-back. It
 * costs two extra taps, and it buys a rule with no exceptions: nobody ever ends
 * up following someone without having said yes to it.
 */
export async function requestFollow(meId: string, targetId: string): Promise<FollowResult> {
  if (meId === targetId) throw new ApiError(400, 'You cannot follow yourself');

  const [me, target] = await Promise.all([getUserOrThrow(meId), getUserOrThrow(targetId)]);

  if (me.following.some((id) => String(id) === targetId)) {
    throw new ApiError(409, 'You already follow this person');
  }

  // Upsert, so a double tap cannot create two requests.
  await FollowRequestModel.updateOne(
    { from: me._id, to: target._id },
    { $setOnInsert: { from: me._id, to: target._id } },
    { upsert: true }
  );

  return { relationship: await describeUser(meId, targetId), accepted: false };
}

/** Withdraw a request you sent before they acted on it. */
export async function cancelRequest(meId: string, targetId: string): Promise<UserDTO> {
  const target = await getUserOrThrow(targetId);

  const result = await FollowRequestModel.deleteOne({
    from: new Types.ObjectId(meId),
    to: target._id,
  });

  if (result.deletedCount === 0) throw new ApiError(404, 'No pending request to cancel');

  return describeUser(meId, targetId);
}

/** Everyone waiting on your decision. */
export async function listIncomingRequests(meId: string): Promise<UserDTO[]> {
  const ctx = await loadContext(meId);

  const requests = await FollowRequestModel.find({ to: ctx.me._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const requesters = await UserModel.find({
    _id: { $in: requests.map((r) => r.from) },
  }).exec();

  return requesters.map((user) => toUserDTO(user, ctx));
}

/** `requesterId` now follows me. */
export async function acceptRequest(meId: string, requesterId: string): Promise<UserDTO> {
  const result = await FollowRequestModel.deleteOne({
    from: new Types.ObjectId(requesterId),
    to: new Types.ObjectId(meId),
  });

  if (result.deletedCount === 0) throw new ApiError(404, 'No such follow request');

  await applyFollow(requesterId, meId);

  return describeUser(meId, requesterId);
}

export async function declineRequest(meId: string, requesterId: string): Promise<UserDTO> {
  const result = await FollowRequestModel.deleteOne({
    from: new Types.ObjectId(requesterId),
    to: new Types.ObjectId(meId),
  });

  if (result.deletedCount === 0) throw new ApiError(404, 'No such follow request');

  return describeUser(meId, requesterId);
}

/** Stop following someone you already follow. */
export async function unfollowUser(meId: string, targetId: string): Promise<UserDTO> {
  const target = await getUserOrThrow(targetId);

  await Promise.all([
    UserModel.updateOne({ _id: meId }, { $pull: { following: target._id } }),
    UserModel.updateOne({ _id: targetId }, { $pull: { followers: new Types.ObjectId(meId) } }),
  ]);

  return describeUser(meId, targetId);
}

export async function listFollowing(meId: string): Promise<UserDTO[]> {
  const ctx = await loadContext(meId);
  const users = await UserModel.find({ _id: { $in: ctx.me.following } }).exec();
  return users.map((user) => toUserDTO(user, ctx));
}

export async function listFollowers(meId: string): Promise<UserDTO[]> {
  const ctx = await loadContext(meId);
  const users = await UserModel.find({ _id: { $in: ctx.me.followers } }).exec();
  return users.map((user) => toUserDTO(user, ctx));
}

/** Everyone you can actually start a chat with. */
export async function getMutuals(meId: string): Promise<UserDTO[]> {
  const ctx = await loadContext(meId);

  const mutuals = await UserModel.find({
    _id: { $in: ctx.me.following },
    following: ctx.me._id,
  }).exec();

  return mutuals.map((user) => toUserDTO(user, ctx));
}

/** Writes an accepted follow: `followerId` → `followeeId`. */
async function applyFollow(followerId: string, followeeId: string): Promise<void> {
  // $addToSet, so following twice is a no-op rather than duplicating the entry.
  await Promise.all([
    UserModel.updateOne(
      { _id: followerId },
      { $addToSet: { following: new Types.ObjectId(followeeId) } }
    ),
    UserModel.updateOne(
      { _id: followeeId },
      { $addToSet: { followers: new Types.ObjectId(followerId) } }
    ),
  ]);
}
