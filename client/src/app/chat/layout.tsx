'use client';

import { useEffect } from 'react';
import { useRouter, useSelectedLayoutSegment } from 'next/navigation';
import Link from 'next/link';

import { RequireAuth } from '@/components/RouteGuard';
import { ChatProvider } from '@/context/ChatContext';
import { useAuth } from '@/context/AuthContext';
import Rail from '@/components/chat/Rail';
import BottomNav from '@/components/chat/BottomNav';
import ChatList from '@/components/chat/ChatList';
import Avatar from '@/components/chat/Avatar';
import { cn } from '@/lib/utils';

/**
 * The shell.
 *
 * Desktop — three columns: a narrow icon rail, the chat list, and the chat area
 * as an inset panel floating on the canvas. The gap around the panel is what
 * makes the conversation feel like a surface you are working *on* rather than a
 * region of the page.
 *
 * Mobile — WhatsApp: one screen at a time. The list fills the display with a
 * bottom nav; opening a chat replaces it entirely and hides the nav, so the
 * conversation gets every pixel. Same routes on both, so a link to a chat works
 * identically.
 */
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <ChatProvider>
        <Shell>{children}</Shell>
      </ChatProvider>
    </RequireAuth>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  const router = useRouter();
  const { user } = useAuth();

  // `__PAGE__` is /chat itself; 'people' and 'profile' are their own screens.
  // Anything else is a conversation id.
  const isThreadOpen = segment !== null && !['__PAGE__', 'people', 'profile'].includes(segment);
  const isSecondary = segment === 'people' || segment === 'profile';

  /**
   * Escape closes the conversation.
   *
   * Only ever a *navigation* — it never deletes or discards anything, so there is
   * nothing to confirm. It is also ignored while a dialog or the lightbox is up,
   * because those bind Escape themselves and stop the event before it reaches
   * here; closing the photo AND the chat with one keypress would be maddening.
   */
  useEffect(() => {
    if (!isThreadOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;

      // Don't yank the chat away while they are mid-sentence.
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
        active.blur();
        return;
      }

      router.push('/chat');
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isThreadOpen, router]);

  // The list column is the middle column on desktop, and the WHOLE screen on
  // mobile — but only when nothing else is open on top of it.
  const showListOnMobile = !isThreadOpen && !isSecondary;

  return (
    /**
     * The shell fills the viewport edge to edge. No outer padding, no outer
     * rounding — the rounded frame in the sketch is the *screen*.
     *
     * Rail, list and canvas all share ONE background. Nothing separates the list
     * from the chat area: the seam is made by the panel's own outline and the gap
     * around it, not by a divider. A border there would cut the surface in half.
     */
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Rail />

        <aside
          className={cn(
            'w-full shrink-0 md:block md:w-[320px] lg:w-[360px]',
            showListOnMobile ? 'block' : 'hidden'
          )}
        >
          <ChatList />
        </aside>

        <main
          className={cn(
            'relative min-w-0 flex-1 flex-col md:flex',
            showListOnMobile ? 'hidden' : 'flex'
          )}
        >
          {/* The profile button from the sketch: top-right, on the canvas above
              the panel. Desktop only — mobile has it in the bottom nav. */}
          <div className="hidden shrink-0 justify-end px-4 pt-3 md:flex">
            <Link
              href="/chat/profile"
              aria-label="Your profile"
              className={cn(
                'rounded-full ring-offset-2 ring-offset-background transition hover:ring-2 hover:ring-foreground/20',
                segment === 'profile' && 'ring-2 ring-foreground'
              )}
            >
              {user && <Avatar username={user.username} avatarUrl={user.avatarUrl} size="sm" />}
            </Link>
          </div>

          {/* THE panel: the only raised surface on the screen. On mobile it is
              full-bleed — a phone has no pixels to spend on a decorative margin. */}
          <div className="min-h-0 flex-1 overflow-hidden border-border bg-card md:mb-3 md:ml-1 md:mr-3 md:mt-2 md:rounded-2xl md:border">
            {children}
          </div>
        </main>
      </div>

      {!isThreadOpen && <BottomNav />}
    </div>
  );
}
