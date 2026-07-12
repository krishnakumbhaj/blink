'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useDebounce } from '@uidotdev/usehooks';

import { fetchFollowers, fetchFollowing, searchUsers } from '@/lib/chat-api';
import { useAuth } from '@/context/AuthContext';
import { useChatContext } from '@/context/ChatContext';
import { Icon, Spinner } from '@/components/ui/icon';
import UserRow from '@/components/people/UserRow';
import { cn } from '@/lib/utils';
import type { ChatUser } from '@/types/chat';

type Tab = 'requests' | 'following' | 'followers';

const TABS: { id: Tab; label: string }[] = [
  { id: 'requests', label: 'Requests' },
  { id: 'following', label: 'Following' },
  { id: 'followers', label: 'Followers' },
];

/**
 * Everything to do with following, in one place.
 *
 * Search sits above the tabs rather than being a fourth tab: searching is how
 * you *find* people, while the tabs are how you manage the ones you already have
 * a relationship with. Typing anything replaces the tab content with results,
 * which keeps discovery a single gesture away from any view.
 */
export default function PeoplePage() {
  const { token } = useAuth();
  const { requests, refreshRequests } = useChatContext();

  const [tab, setTab] = useState<Tab>('requests');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChatUser[]>([]);
  const [following, setFollowing] = useState<ChatUser[]>([]);
  const [followers, setFollowers] = useState<ChatUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const debounced = useDebounce(query.trim(), 350);
  const isSearching = debounced.length > 0;

  // Search.
  useEffect(() => {
    if (!token || !isSearching) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    searchUsers(token, debounced)
      .then((users) => !cancelled && setResults(users))
      .catch(() => !cancelled && setResults([]))
      .finally(() => !cancelled && setIsLoading(false));

    return () => {
      cancelled = true;
    };
  }, [token, debounced, isSearching]);

  // Whichever tab is open.
  const loadTab = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);

    try {
      if (tab === 'requests') await refreshRequests();
      else if (tab === 'following') setFollowing(await fetchFollowing(token));
      else setFollowers(await fetchFollowers(token));
    } finally {
      setIsLoading(false);
    }
  }, [token, tab, refreshRequests]);

  useEffect(() => {
    if (!isSearching) void loadTab();
  }, [loadTab, isSearching]);

  /**
   * A row's relationship changed. Patch it in place rather than refetching, so
   * the list does not jump under the cursor mid-click — but drop it from the
   * Requests tab, since it is no longer a request.
   */
  const patch = useCallback(
    (updated: ChatUser) => {
      const swap = (list: ChatUser[]) =>
        list.map((u) => (u.id === updated.id ? updated : u));

      setResults(swap);
      setFollowing(swap);
      setFollowers(swap);
    },
    []
  );

  const visible = isSearching
    ? results
    : tab === 'requests'
      ? requests
      : tab === 'following'
        ? following
        : followers;

  const emptyCopy = isSearching
    ? `No one found matching “${query}”`
    : tab === 'requests'
      ? 'No follow requests right now.'
      : tab === 'following'
        ? 'You are not following anyone yet. Search for someone above.'
        : 'Nobody follows you yet.';

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="border-b border-border px-3 py-3 sm:px-4">
        <div className="mb-3 flex items-center gap-2">
          {/* Mobile only: the sidebar is hidden behind this route. */}
          <Link
            href="/chat"
            aria-label="Back to messages"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground transition hover:bg-secondary md:hidden"
          >
            <Icon name="back" />
          </Link>
          <h1 className="text-base font-semibold text-foreground">People</h1>
        </div>

        <div className="relative mb-3">
          <Icon
            name="search"
            size={18}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by username"
            aria-label="Search people by username"
            className="h-10 w-full rounded-xl border border-input bg-background pl-10 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        {!isSearching && (
          <nav className="flex gap-1" role="tablist">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                  tab === id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
              >
                {label}
                {id === 'requests' && requests.length > 0 && (
                  <span
                    className={cn(
                      'flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] tabular-nums',
                      tab === id
                        ? 'bg-primary-foreground text-primary'
                        : 'bg-primary text-primary-foreground'
                    )}
                  >
                    {requests.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        )}
      </header>

      <div className="scrollbar-slim flex-1 overflow-y-auto p-2">
        {isLoading && visible.length === 0 ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : visible.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm leading-relaxed text-muted-foreground">
            {emptyCopy}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {visible.map((user) => (
              <UserRow key={user.id} user={user} onChange={patch} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
