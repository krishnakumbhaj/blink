/** The identity carried by a verified JWT. */
export interface AuthUser {
  id: string;
  username: string;
}

/** You, as returned by auth endpoints. */
export interface SelfDTO {
  id: string;
  username: string;
  /** Relative path, e.g. "/api/uploads/9f3…". Null means "render initials". */
  avatarUrl: string | null;
}

/** How another user looks to you: who they are, and where you stand with them. */
export interface UserDTO {
  id: string;
  username: string;
  /** Relative path to their photo, or null — the client falls back to initials. */
  avatarUrl: string | null;
  /** Accepted: you follow them. */
  isFollowing: boolean;
  /** Accepted: they follow you. */
  followsYou: boolean;
  /** Both directions — the only state in which either of you may send a message. */
  isMutual: boolean;
  /** Pending: you asked to follow them, awaiting their decision. */
  requestSent: boolean;
  /** Pending: they asked to follow you, awaiting yours. */
  requestReceived: boolean;
}

/**
 * The single word the UI needs to decide what button to draw. Derived on the
 * server so the client never has to reason about five booleans at once.
 */
export type RelationshipState =
  | 'none' // no link at all → "Follow"
  | 'requestSent' // awaiting their decision → "Requested"
  | 'requestReceived' // awaiting yours → "Accept" / "Decline"
  | 'following' // you follow them, they don't follow back → "Following"
  | 'followsYou' // they follow you, you don't follow back → "Follow back"
  | 'mutual'; // both → "Message"

export interface AttachmentDTO {
  key: string;
  /** Relative path. The client prefixes it with the server origin. */
  url: string;
  name: string;
  contentType: string;
  size: number;
  /** True only for types we will render inline. Everything else downloads. */
  isImage: boolean;
}

export interface MessageDTO {
  id: string;
  conversationId: string;
  senderId: string;
  /** Empty string when the message is attachments only, or when it was retracted. */
  text: string;
  attachments: AttachmentDTO[];
  /** Passed on from another chat. */
  forwarded: boolean;
  /** Retracted by its sender. The client renders a tombstone, not the content. */
  deletedForEveryone: boolean;
  delivered: boolean;
  read: boolean;
  createdAt: string;
}

/** Who a deletion applies to. */
export type DeleteScope = 'me' | 'everyone';

/** One row of the inbox. */
export interface ConversationDTO {
  id: string;
  /** The person you are talking to. A conversation always has exactly one other. */
  otherUser: UserDTO;
  lastMessage: { text: string; senderId: string; createdAt: string } | null;
  unreadCount: number;
  updatedAt: string;
}

export interface OnlineUser {
  id: string;
  username: string;
}

export interface ServerToClientEvents {
  'message:new': (message: MessageDTO) => void;
  'message:status': (update: { conversationId: string; ids: string[]; read: boolean }) => void;
  /** A message was retracted. Only ever sent for a delete-for-everyone. */
  'message:deleted': (payload: { conversationId: string; id: string }) => void;
  /** A conversation was destroyed for both sides. */
  'conversation:deleted': (payload: { conversationId: string }) => void;
  'conversation:update': (conversation: ConversationDTO) => void;
  'typing:update': (payload: { conversationId: string; username: string; isTyping: boolean }) => void;
  'presence:update': (payload: { online: OnlineUser[] }) => void;
  /** Someone asked to follow you — bump the requests badge without a refresh. */
  'follow:request': (payload: { user: UserDTO }) => void;
  /** Your relationship with someone changed (accepted, declined, unfollowed). */
  'follow:update': (payload: { user: UserDTO }) => void;
  'chat:error': (payload: { message: string }) => void;
}

export interface ClientToServerEvents {
  'typing:start': (payload: { conversationId: string }) => void;
  'typing:stop': (payload: { conversationId: string }) => void;
  'message:read': (payload: { conversationId: string }) => void;
}

export interface SocketData {
  user: AuthUser;
}
