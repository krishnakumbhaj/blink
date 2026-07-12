import type { OnlineUser } from '../types';

/**
 * Tracks who is online.
 *
 * Keyed by userId with a Set of socket ids, not a flat list, because one user
 * can have several tabs open. Closing one tab must not flip them offline — they
 * go offline only when their last socket disconnects.
 */
class PresenceRegistry {
  private users = new Map<string, { username: string; sockets: Set<string> }>();

  /** Returns true if this connection brought the user online (their first socket). */
  add(userId: string, username: string, socketId: string): boolean {
    const existing = this.users.get(userId);

    if (existing) {
      existing.sockets.add(socketId);
      return false;
    }

    this.users.set(userId, { username, sockets: new Set([socketId]) });
    return true;
  }

  /** Returns true if this disconnect took the user offline (their last socket). */
  remove(userId: string, socketId: string): boolean {
    const existing = this.users.get(userId);
    if (!existing) return false;

    existing.sockets.delete(socketId);
    if (existing.sockets.size > 0) return false;

    this.users.delete(userId);
    return true;
  }

  /** Drives the "delivered" tick — was the recipient reachable when we sent? */
  isOnline(userId: string): boolean {
    return this.users.has(userId);
  }

  list(): OnlineUser[] {
    return [...this.users.entries()].map(([id, { username }]) => ({ id, username }));
  }
}

export const presence = new PresenceRegistry();

/** Every socket a user owns is in this room, so one emit reaches all their tabs. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}
