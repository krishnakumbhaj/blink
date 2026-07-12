import Link from 'next/link';
import { Icon } from '@/components/ui/icon';

/**
 * The empty chat area — what you see with no conversation open, including right
 * after Escape closes one. On mobile this pane is hidden entirely at /chat; the
 * list fills the screen instead.
 */
export default function ChatIndexPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-secondary">
        <Icon name="chats" size={24} className="text-foreground" />
      </div>

      <div>
        <p className="font-semibold text-foreground">Your messages</p>
        <p className="mt-1 max-w-xs text-sm leading-relaxed text-muted-foreground">
          Pick a conversation, or find someone in{' '}
          <Link
            href="/chat/people"
            className="font-medium text-foreground underline underline-offset-2"
          >
            Community
          </Link>
          .
        </p>
      </div>

      <p className="mt-2 hidden text-xs text-muted-foreground md:block">
        Press{' '}
        <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-sans text-[10px] font-medium text-foreground">
          Esc
        </kbd>{' '}
        to close a chat
      </p>
    </div>
  );
}
