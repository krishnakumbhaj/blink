'use client';

import Image from 'next/image';
import Link from 'next/link';
import { RequireGuest } from '@/components/RouteGuard';
import Logo from '@/app/images/Logo.png';

function Landing() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md text-center">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Image src={Logo} alt="" className="h-16 w-16" />
        </div>

        <h1 className="mb-2 text-3xl font-semibold text-foreground">Real-time chat</h1>
        <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
          Messages land instantly, history survives a refresh, and you can see who is online
          and who is typing.
        </p>

        <div className="flex justify-center gap-3">
          <Link
            href="/sign-in"
            className="rounded-lg border border-foreground/20 px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-foreground/5"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            Create account
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function LandingPage() {
  return (
    <RequireGuest>
      <Landing />
    </RequireGuest>
  );
}
