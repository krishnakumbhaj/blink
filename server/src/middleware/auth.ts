import type { Request, Response, NextFunction } from 'express';
import type { Socket } from 'socket.io';
import { verifyAuthToken } from '../lib/token';
import type { AuthUser } from '../types';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Guards the REST API. Expects `Authorization: Bearer <chat jwt>`. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Missing bearer token' });
    return;
  }

  try {
    req.user = verifyAuthToken(header.slice('Bearer '.length));
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

/**
 * Guards the Socket.io handshake. Runs once per connection, before any event
 * handler — so every handler downstream can trust `socket.data.user` exists.
 */
export function socketAuth(socket: Socket, next: (err?: Error) => void): void {
  const token = socket.handshake.auth?.token as string | undefined;

  if (!token) {
    next(new Error('Missing auth token'));
    return;
  }

  try {
    socket.data.user = verifyAuthToken(token);
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
}
