'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/icon';

/** Chrome's install event. Not in the DOM lib, because it is not standardised. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'blink.installDismissed';

/**
 * "Install app" — shown only when the browser says it is actually installable.
 *
 * Chrome fires `beforeinstallprompt` and lets you defer it; you may only call
 * `prompt()` from a real user gesture, which is why the event is stashed rather
 * than fired immediately.
 *
 * iOS/Safari fires nothing at all and has no programmatic install. There is no
 * way to prompt there, so we do not pretend — the banner simply never appears,
 * and iOS users install via Share → Add to Home Screen. Showing a fake "Install"
 * button that cannot install is worse than showing nothing.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Already installed — the browser runs us in standalone display mode.
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (localStorage.getItem(DISMISSED_KEY)) return;

    const onBeforeInstall = (event: Event) => {
      // Suppress Chrome's own mini-infobar so ours is the only prompt.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setIsVisible(true);
    };

    const onInstalled = () => setIsVisible(false);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!isVisible || !deferred) return null;

  function dismiss() {
    // Remember it. Nagging someone who already said no is how an install prompt
    // becomes the thing people hate about your app.
    localStorage.setItem(DISMISSED_KEY, '1');
    setIsVisible(false);
  }

  async function install() {
    if (!deferred) return;

    await deferred.prompt();
    await deferred.userChoice;

    // The event is single-use; a second prompt() on it throws.
    setDeferred(null);
    setIsVisible(false);
  }

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-sm rounded-2xl border border-border bg-card p-3 shadow-lg md:left-auto md:right-4 md:mx-0">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" className="h-10 w-10 rounded-xl" />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Install Blink</p>
          <p className="text-xs text-muted-foreground">Full screen, and one tap from your home screen.</p>
        </div>

        <button
          onClick={dismiss}
          aria-label="Not now"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <Icon name="close" size={15} />
        </button>
      </div>

      <button
        onClick={() => void install()}
        className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
      >
        <Icon name="download" size={16} />
        Install
      </button>
    </div>
  );
}
