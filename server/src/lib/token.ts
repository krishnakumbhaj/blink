import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { AuthUser } from '../types';

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * This server is the sole issuer and verifier of auth tokens. One secret, one
 * place — nothing to keep in sync across services, and any client (web, mobile,
 * curl) authenticates the same way.
 */
export function signAuthToken(user: AuthUser): string {
  return jwt.sign({ username: user.username }, env.JWT_SECRET, {
    subject: user.id,
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

export function verifyAuthToken(token: string): AuthUser {
  const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;

  if (!payload.sub || typeof payload.username !== 'string') {
    throw new Error('Token is missing required claims');
  }

  return { id: payload.sub, username: payload.username };
}

export const TOKEN_LIFETIME_SECONDS = TOKEN_TTL_SECONDS;
