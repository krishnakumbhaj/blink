'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useSelectedLayoutSegment } from 'next/navigation';

import { useAuth } from '@/context/AuthContext';
import { useChatContext } from '@/context/ChatContext';
import { Icon, type IconName } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import Logo from '@/app/images/Logo.png';

/**
 * The narrow icon rail. Desktop only — on mobile this becomes a bottom nav,
 * because a vertical rail on a phone wastes the one axis you cannot spare.
 *
 * Chats and Community sit at the top; Sign out is pinned to the bottom, away
 * from everything else, so it is never the thing you hit by accident.
 */
export default function Rail() {
  const { signOut } = useAuth();
  const { requests } = useChatContext();
  const segment = useSelectedLayoutSegment();

  const isCommunity = segment === 'people';
  // Everything that is not the community or the profile is "chats" — including
  // an open thread, whose segment is the conversation id.
  const isChats = !isCommunity && segment !== 'profile';

  return (
    // Sits on the same canvas as the list. Only a hairline separates them —
    // that thin vertical rule is the one divider in the sketch.
    <nav className="hidden w-[68px] shrink-0 flex-col items-center border-r border-border bg-background py-4 md:flex">
      <Image src={Logo} alt="Blink" className="mb-6 h-8 w-8" />

      <div className="flex flex-1 flex-col items-center gap-1">
        <RailButton href="/chat" icon="chats" label="Chats" isActive={isChats} />
        <RailButton
          href="/chat/people"
          icon="community"
          label="Community"
          isActive={isCommunity}
          badge={requests.length}
        />
      </div>

      <button
        onClick={signOut}
        aria-label="Sign out"
        className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-secondary hover:text-foreground"
      >
        <Icon name="logout" size={20} />
      </button>
    </nav>
  );
}

function RailButton({
  href,
  icon,
  label,
  isActive,
  badge = 0,
}: {
  href: string;
  icon: IconName;
  label: string;
  isActive: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      aria-label={badge > 0 ? `${label} — ${badge} pending` : label}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'relative flex h-11 w-11 items-center justify-center rounded-xl transition',
        isActive
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      )}
    >
      <Icon name={icon} size={21} />

      {badge > 0 && !isActive && (
        <span className="absolute -right-0.5 -top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-background bg-primary px-1 text-[9px] font-semibold tabular-nums text-primary-foreground">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </Link>
  );
}
