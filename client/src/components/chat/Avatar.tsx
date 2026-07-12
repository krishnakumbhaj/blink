'use client';

import { useState } from 'react';
import { mediaUrl } from '@/lib/chat-api';
import { cn } from '@/lib/utils';

/**
 * Fourteen colours, every one of which carries white text at ≥5:1 (worst case
 * amber and green, both 5.02:1). The obvious mid-tone greens, teals and oranges
 * had to be dropped for their darker cousins — #16A34A is only 3.3:1 against
 * white, which looks fine in a mock-up and is unreadable in practice.
 *
 * The full hue range matters: a palette of only reds and purples makes two
 * strangers look related.
 */
const AVATAR_COLORS = [
  '#BE123C', // rose
  '#C2410C', // orange
  '#B45309', // amber
  '#15803D', // green
  '#0F766E', // teal
  '#0E7490', // cyan
  '#0369A1', // sky
  '#1D4ED8', // blue
  '#4338CA', // indigo
  '#6D28D9', // violet
  '#A21CAF', // fuchsia
  '#BE185D', // pink
  '#334155', // slate
  '#57534E', // stone
] as const;

/**
 * Deterministic, so a person is the same colour everywhere and on every device —
 * in the inbox, in the thread header, in search results. A random colour per
 * render would make the app feel broken.
 */
function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const SIZES = {
  xs: 'h-7 w-7 text-[11px]',
  sm: 'h-9 w-9 text-sm',
  md: 'h-11 w-11 text-base',
  lg: 'h-16 w-16 text-2xl',
  xl: 'h-24 w-24 text-4xl',
} as const;

const DOT_SIZES = {
  xs: 'h-2 w-2',
  sm: 'h-2.5 w-2.5',
  md: 'h-3 w-3',
  lg: 'h-4 w-4',
  xl: 'h-5 w-5',
} as const;

interface AvatarProps {
  username: string;
  /** Their photo. Relative path from the API; null falls back to initials. */
  avatarUrl?: string | null;
  size?: keyof typeof SIZES;
  /** Show the presence dot at all (omit in lists where presence is meaningless). */
  showPresence?: boolean;
  isOnline?: boolean;
  /** Ring colour behind the dot — must match whatever the avatar sits on. */
  ringClass?: string;
  className?: string;
}

export default function Avatar({
  username,
  avatarUrl,
  size = 'md',
  showPresence = false,
  isOnline = false,
  ringClass = 'ring-card',
  className,
}: AvatarProps) {
  // A photo that 404s (deleted upload, dead link) must degrade to initials
  // rather than leaving a broken-image glyph.
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(avatarUrl) && !failed;

  return (
    <div className={cn('relative shrink-0', className)}>
      {showPhoto ? (
        // Deliberately a plain <img>, not next/image: these are user uploads
        // served from the API origin at unpredictable paths, so Next's optimiser
        // would need remotePatterns configured for a domain that changes per
        // deploy — for no benefit, since we already compress on upload.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mediaUrl(avatarUrl!)}
          alt=""
          onError={() => setFailed(true)}
          className={cn('rounded-full object-cover', SIZES[size])}
        />
      ) : (
        <div
          className={cn(
            'flex select-none items-center justify-center rounded-full font-semibold uppercase text-white',
            SIZES[size]
          )}
          style={{ backgroundColor: colorFor(username) }}
          aria-hidden
        >
          {username.charAt(0)}
        </div>
      )}

      {showPresence && (
        <span
          aria-label={isOnline ? 'Online' : 'Offline'}
          className={cn(
            'absolute bottom-0 right-0 rounded-full ring-2',
            DOT_SIZES[size],
            ringClass,
            // Green is the one colour in this app that is not black. Presence is
            // the one thing worth spending it on — it is glanceable in a way a
            // grey/black dot never is.
            isOnline ? 'bg-emerald-500' : 'bg-stone-300'
          )}
        />
      )}
    </div>
  );
}
