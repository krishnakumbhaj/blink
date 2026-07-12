'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/chat-api';
import type { ChatIdentity } from '@/types/chat';

const TOKEN_KEY = 'viboz.token';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: ChatIdentity | null;
  token: string | null;
  status: AuthStatus;
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (input: { username: string; email: string; password: string }) => Promise<void>;
  signOut: () => void;
  /** Patch the cached user — e.g. after changing the profile photo. */
  updateUser: (user: ChatIdentity) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The server is the sole issuer of tokens, so the client's job is only to hold
 * one and prove it is still valid.
 *
 * The token lives in localStorage. That is readable by any script on the page,
 * so it is XSS-exposed — the safer alternative is an httpOnly cookie, but a
 * cookie set by the API's origin (:5000) is never sent to the app's origin
 * (:3000) in production, so it cannot be read here to drive the UI. For this
 * app localStorage is the honest trade: simple, and it works identically for a
 * future mobile client.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ChatIdentity | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const router = useRouter();

  // On boot, a stored token is only a *claim*. Ask the server whether it is
  // still good — it may have expired, or been signed with a rotated secret.
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);

    if (!stored) {
      setStatus('unauthenticated');
      return;
    }

    let cancelled = false;

    api
      .fetchMe(stored)
      .then(({ user: me }) => {
        if (cancelled) return;
        setToken(stored);
        setUser(me);
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        localStorage.removeItem(TOKEN_KEY);
        setStatus('unauthenticated');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const adopt = useCallback((result: api.AuthResult) => {
    localStorage.setItem(TOKEN_KEY, result.token);
    setToken(result.token);
    setUser(result.user);
    setStatus('authenticated');
  }, []);

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      adopt(await api.login({ identifier, password }));
    },
    [adopt]
  );

  const signUp = useCallback(
    async (input: { username: string; email: string; password: string }) => {
      adopt(await api.register(input));
    },
    [adopt]
  );

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setStatus('unauthenticated');
    router.replace('/sign-in');
  }, [router]);

  const updateUser = useCallback((next: ChatIdentity) => setUser(next), []);

  const value = useMemo(
    () => ({ user, token, status, signIn, signUp, signOut, updateUser }),
    [user, token, status, signIn, signUp, signOut, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return context;
}
