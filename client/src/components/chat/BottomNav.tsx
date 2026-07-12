'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';

import { useAuth } from '@/context/AuthContext';
import { useChatContext } from '@/context/ChatContext';
import { Icon, type IconName } from '@/components/ui/icon';
import Avatar from './Avatar';
import { cn } from '@/lib/utils';

/**
 * Mobile navigation, WhatsApp-style: a bottom bar, thumb-reachable, and hidden
 * entirely once a thread is open so the conversation gets the whole screen.
 */
export default function BottomNav() {
  const { user } = useAuth();
  const { requests } = useChatContext();
  const segment = useSelectedLayoutSegment();

  const isCommunity = segment === 'people';
  const isProfile = segment === 'profile';
  const isChats = !isCommunity && !isProfile;

  return (
    <nav className="flex shrink-0 items-stretch border-t border-border bg-card md:hidden">
      <NavButton href="/chat" icon="chats" label="Chats" isActive={isChats} />
      <NavButton
        href="/chat/people"
        icon="community"
        label="Community"
        isActive={isCommunity}
        badge={requests.length}
      />

      <Link
        href="/chat/profile"
        aria-current={isProfile ? 'page' : undefined}
        className={cn(
          'flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium transition',
          isProfile ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        <span className={cn('rounded-full', isProfile && 'ring-2 ring-foreground ring-offset-2 ring-offset-card')}>
          {user && <Avatar username={user.username} avatarUrl={user.avatarUrl} size="xs" />}
        </span>
        You
      </Link>
    </nav>
  );
}

function NavButton({
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
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'relative flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium transition',
        isActive ? 'text-foreground' : 'text-muted-foreground'
      )}
    >
      <span className="relative">
        <Icon name={icon} size={22} strokeWidth={isActive ? 2.2 : 1.8} />

        {badge > 0 && (
          <span className="absolute -right-2 -top-1 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold tabular-nums text-primary-foreground">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </span>
      {label}
    </Link>
  );
}
