/** Mirrors the server's DTOs. Kept in sync by hand — the two services deploy
 *  separately, so there is no shared build step. */

/** Another person, and where you stand with them. */
export interface ChatUser {
  id: string;
  username: string;
  /** Relative path to their photo, or null — the Avatar falls back to initials. */
  avatarUrl: string | null;
  /** Accepted: you follow them. */
  isFollowing: boolean;
  /** Accepted: they follow you. */
  followsYou: boolean;
  /** Both directions. The only state in which either of you may send a message. */
  isMutual: boolean;
  /** Pending: you asked to follow them, awaiting their decision. */
  requestSent: boolean;
  /** Pending: they asked to follow you, awaiting yours. */
  requestReceived: boolean;
}

/** The one word the UI needs to decide which button to draw. */
export type RelationshipState =
  | 'none'
  | 'requestSent'
  | 'requestReceived'
  | 'following'
  | 'followsYou'
  | 'mutual';

/**
 * Collapse the five booleans into a single state.
 *
 * Order matters: `mutual` must be checked before `following`, and a received
 * request outranks a sent one — if you have both, the decision that is yours to
 * make is the one worth surfacing.
 */
export function getRelationship(user: ChatUser): RelationshipState {
  if (user.isMutual) return 'mutual';
  if (user.requestReceived) return 'requestReceived';
  if (user.requestSent) return 'requestSent';
  if (user.isFollowing) return 'following';
  if (user.followsYou) return 'followsYou';
  return 'none';
}

export interface ChatIdentity {
  id: string;
  username: string;
  avatarUrl: string | null;
}

export interface Attachment {
  key: string;
  /** Relative path from the API. */
  url: string;
  name: string;
  contentType: string;
  size: number;
  /** True only for types the server will serve inline. Everything else downloads. */
  isImage: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  /** Empty when the message is attachments only, or when it was retracted. */
  text: string;
  attachments: Attachment[];
  /** Passed on from another chat. */
  forwarded: boolean;
  /** Retracted by its sender — render a tombstone, not the content. */
  deletedForEveryone: boolean;
  delivered: boolean;
  read: boolean;
  createdAt: string;
}

/** "1.4 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One row of the inbox. */
export interface Conversation {
  id: string;
  otherUser: ChatUser;
  lastMessage: { text: string; senderId: string; createdAt: string } | null;
  unreadCount: number;
  updatedAt: string;
}

export interface OnlineUser {
  id: string;
  username: string;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'error';

/** What one of your own messages looks like to you. */
export type MessageStatus = 'sent' | 'delivered' | 'read';

export function getMessageStatus(message: ChatMessage): MessageStatus {
  if (message.read) return 'read';
  if (message.delivered) return 'delivered';
  return 'sent';
}
