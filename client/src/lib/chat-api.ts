import type { Attachment, ChatIdentity, ChatMessage, ChatUser, Conversation } from '@/types/chat';

export const CHAT_SERVER_URL =
  process.env.NEXT_PUBLIC_CHAT_SERVER_URL ?? 'http://localhost:5000';

/**
 * The API returns image paths as relative ("/api/uploads/9f3…") because it does
 * not know its own public origin. The browser does, so it prefixes them here.
 */
export function mediaUrl(path: string): string {
  return path.startsWith('http') ? path : `${CHAT_SERVER_URL}${path}`;
}

/**
 * The same file, but forced to save rather than open.
 *
 * The HTML `download` attribute is IGNORED for cross-origin URLs, and the API is
 * a different origin from the app — so `<a download>` on a photo would just open
 * it in a tab. Only the server's Content-Disposition can actually force a save,
 * which is what `?download=1` asks it for.
 */
export function downloadUrl(path: string): string {
  return `${mediaUrl(path)}?download=1`;
}

/** Thrown for any non-2xx from the API, carrying the server's own message. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Envelope<T> {
  success: boolean;
  message?: string;
  data?: T;
}

async function request<T>(
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {}
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${CHAT_SERVER_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    // fetch only rejects on network failure — a server that is down looks like this.
    throw new ApiError(0, 'Cannot reach the chat server. Is it running?');
  }

  let body: Envelope<T>;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    throw new ApiError(response.status, `Unexpected response (${response.status})`);
  }

  if (!response.ok || !body.success) {
    throw new ApiError(response.status, body.message ?? 'Request failed');
  }

  return body.data as T;
}

export interface AuthResult {
  token: string;
  user: ChatIdentity;
}

// ------------------------------------------------------------------ auth

export const register = (input: { username: string; email: string; password: string }) =>
  request<AuthResult>('/api/auth/register', { method: 'POST', body: input });

export const login = (input: { identifier: string; password: string }) =>
  request<AuthResult>('/api/auth/login', { method: 'POST', body: input });

/** Validates a stored token on boot. Throws 401 if it has expired. */
export const fetchMe = (token: string) =>
  request<{ user: ChatIdentity }>('/api/auth/me', { token });

export const checkUsername = (username: string) =>
  request<{ available: boolean }>(
    `/api/auth/check-username?username=${encodeURIComponent(username)}`
  );

// ------------------------------------------------------------------ people

/** Find people by username prefix. Never returns you. */
export const searchUsers = (token: string, q: string) =>
  request<ChatUser[]>(`/api/users/search?q=${encodeURIComponent(q)}`, { token });

/** Everyone you can actually start a chat with. */
export const fetchMutuals = (token: string) => request<ChatUser[]>('/api/users/mutuals', { token });

/** Everyone waiting on your decision. */
export const fetchRequests = (token: string) => request<ChatUser[]>('/api/users/requests', { token });

export const fetchFollowing = (token: string) =>
  request<ChatUser[]>('/api/users/following', { token });

export const fetchFollowers = (token: string) =>
  request<ChatUser[]>('/api/users/followers', { token });

/**
 * Ask to follow someone.
 *
 * `accepted` tells you which of the two things happened: normally this raises a
 * pending request, but if they already follow you it takes effect immediately.
 */
export const followUser = (token: string, userId: string) =>
  request<{ relationship: ChatUser; accepted: boolean }>(`/api/users/${userId}/follow`, {
    token,
    method: 'POST',
  });

/** Stop following someone you already follow. */
export const unfollowUser = (token: string, userId: string) =>
  request<ChatUser>(`/api/users/${userId}/follow`, { token, method: 'DELETE' });

/** Withdraw a request you sent, before they act on it. */
export const cancelRequest = (token: string, userId: string) =>
  request<ChatUser>(`/api/users/${userId}/request`, { token, method: 'DELETE' });

/** Let them follow you. */
export const acceptRequest = (token: string, userId: string) =>
  request<ChatUser>(`/api/users/${userId}/accept`, { token, method: 'POST' });

export const declineRequest = (token: string, userId: string) =>
  request<ChatUser>(`/api/users/${userId}/decline`, { token, method: 'POST' });

// ------------------------------------------------------------------ chats

/** The inbox, most recent first. */
export const fetchConversations = (token: string) =>
  request<Conversation[]>('/api/conversations', { token });

/**
 * Open a chat with someone, creating it on first contact.
 * Rejects with 403 unless the two of you follow each other.
 */
export const openConversation = (token: string, userId: string) =>
  request<Conversation>('/api/conversations', { token, method: 'POST', body: { userId } });

export const fetchConversation = (token: string, id: string) =>
  request<Conversation>(`/api/conversations/${id}`, { token });

/** Thread history — this is what survives a page refresh. */
export const fetchMessages = (token: string, conversationId: string, limit = 50) =>
  request<ChatMessage[]>(`/api/conversations/${conversationId}/messages?limit=${limit}`, { token });

/** The write path. The message comes back to us over the socket, not from here. */
export const sendMessage = (
  token: string,
  conversationId: string,
  body: { text?: string; attachmentKeys?: string[] }
) =>
  request<ChatMessage>(`/api/conversations/${conversationId}/messages`, {
    token,
    method: 'POST',
    body,
  });

/**
 * Pass a message on to other chats. The attachments are re-used, not re-uploaded.
 * Each target is authorised independently — forwarding is not a way around the
 * mutual-follow rule.
 */
export const forwardMessage = (
  token: string,
  messageId: string,
  conversationIds: string[]
) =>
  request<ChatMessage[]>('/api/conversations/forward', {
    token,
    method: 'POST',
    body: { messageId, conversationIds },
  });

/** Who a deletion applies to. */
export type DeleteScope = 'me' | 'everyone';

/**
 * `me` hides it from you alone; `everyone` retracts it and is sender-only.
 * The server rejects a retraction of someone else's message with 403.
 */
export const deleteMessage = (
  token: string,
  conversationId: string,
  messageId: string,
  scope: DeleteScope
) =>
  request<{ id: string }>(
    `/api/conversations/${conversationId}/messages/${messageId}?scope=${scope}`,
    { token, method: 'DELETE' }
  );

/**
 * `me` clears your copy — the chat returns if they message you again.
 * `everyone` destroys the thread and every message in it, for both of you.
 */
export const deleteConversation = (
  token: string,
  conversationId: string,
  scope: DeleteScope
) =>
  request<{ id: string }>(`/api/conversations/${conversationId}?scope=${scope}`, {
    token,
    method: 'DELETE',
  });

// ------------------------------------------------------------------ uploads

export type StoredUpload = Attachment;

/**
 * Upload one or many files. Always returns an array, so callers have one path.
 *
 * Multipart, so we set NO Content-Type header — the browser must set it itself,
 * including the multipart boundary. Setting it by hand is the classic way to
 * make an upload fail with a baffling parse error on the server.
 */
export async function uploadFiles(token: string, files: File[]): Promise<StoredUpload[]> {
  const form = new FormData();
  for (const file of files) form.append('files', file);

  let response: Response;
  try {
    response = await fetch(`${CHAT_SERVER_URL}/api/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the chat server. Is it running?');
  }

  const body = (await response.json().catch(() => ({}))) as Envelope<StoredUpload[]>;

  if (!response.ok || !body.success || !body.data) {
    throw new ApiError(response.status, body.message ?? 'Could not upload those files');
  }

  return body.data;
}

/** Set your profile photo, or pass null to go back to initials. */
export const setAvatar = (token: string, avatarKey: string | null) =>
  request<ChatIdentity>('/api/users/me/avatar', {
    token,
    method: 'PATCH',
    body: { avatarKey },
  });
