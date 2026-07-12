'use client';

export default function TypingIndicator({ username }: { username: string | null }) {
  // Reserve the row's height even when idle, so the message list doesn't jump
  // every time they start and stop typing.
  return (
    <div className="h-5 px-4 pb-1" aria-live="polite">
      {username && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="flex gap-0.5">
            <span className="h-1 w-1 animate-bounce rounded-full bg-foreground [animation-delay:0ms]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-foreground [animation-delay:150ms]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-foreground [animation-delay:300ms]" />
          </span>
          {username} is typing
        </p>
      )}
    </div>
  );
}
