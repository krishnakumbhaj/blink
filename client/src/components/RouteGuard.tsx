'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import CircularLoader from '@/components/CircularLoader';

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <CircularLoader />
    </div>
  );
}

/**
 * Auth now lives on the API server, so a Next.js middleware guard is no longer
 * possible: the token is held by the browser, and a cookie set by the API's
 * origin is never sent to this app's origin. Route protection therefore happens
 * on the client.
 *
 * The `loading` state matters — without it, every refresh would flash the
 * sign-in page for a moment before the stored token is validated.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/sign-in');
  }, [status, router]);

  if (status !== 'authenticated') return <FullScreenLoader />;
  return <>{children}</>;
}

/** The inverse: signed-in users should never see the landing or auth pages. */
export function RequireGuest({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated') router.replace('/chat');
  }, [status, router]);

  if (status !== 'unauthenticated') return <FullScreenLoader />;
  return <>{children}</>;
}
