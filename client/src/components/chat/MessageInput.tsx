'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Icon, Spinner } from '@/components/ui/icon';
import { useToast } from '@/components/ui/use-toast';
import { ApiError, uploadFiles } from '@/lib/chat-api';
import { ImageError, prepareFile } from '@/lib/image';
import { useAuth } from '@/context/AuthContext';
import { formatBytes } from '@/types/chat';
import { cn } from '@/lib/utils';

const MAX_FILES = 10;

interface MessageInputProps {
  onSend: (body: { text?: string; attachmentKeys?: string[] }) => Promise<void>;
  onTyping: () => void;
  disabled: boolean;
  /** Shown instead of the composer when the two of you are no longer mutuals. */
  blockedReason?: string;
}

/** A file already compressed and uploaded, waiting to be sent. */
interface Pending {
  key: string;
  name: string;
  size: number;
  isImage: boolean;
  /** Object URL for an instant local preview — no round trip to show a thumbnail. */
  previewUrl?: string;
}

export default function MessageInput({
  onSend,
  onTyping,
  disabled,
  blockedReason,
}: MessageInputProps) {
  const { token } = useAuth();
  const { toast } = useToast();

  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);

  // Object URLs leak until revoked.
  useEffect(() => {
    return () => {
      for (const item of pending) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
    // Intentionally on unmount only — revoking on every change would kill the
    // previews still on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSend = (text.trim().length > 0 || pending.length > 0) && !isSending && !disabled;

  /**
   * Files are uploaded the moment they are picked, not when Send is pressed.
   * By the time a caption is typed they are already on the server, so sending
   * feels instant instead of stalling on a multi-megabyte POST.
   */
  async function handlePick(picked: File[]) {
    if (!token || picked.length === 0) return;

    const room = MAX_FILES - pending.length;
    if (room <= 0) {
      toast({ title: `You can attach at most ${MAX_FILES} files`, variant: 'destructive' });
      return;
    }

    const files = picked.slice(0, room);
    if (picked.length > room) {
      toast({ title: `Only the first ${room} files were attached` });
    }

    setIsUploading(true);
    try {
      const prepared = await Promise.all(files.map((file) => prepareFile(file, 'message')));
      const stored = await uploadFiles(token, prepared);

      setPending((prev) => [
        ...prev,
        ...stored.map((upload, index) => ({
          key: upload.key,
          name: upload.name,
          size: upload.size,
          isImage: upload.isImage,
          previewUrl: upload.isImage ? URL.createObjectURL(prepared[index]) : undefined,
        })),
      ]);
    } catch (error) {
      toast({
        title: 'Could not attach that',
        description:
          error instanceof ImageError || error instanceof ApiError
            ? error.message
            : 'Please try another file.',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
      // Reset, or picking the SAME file twice fires no change event.
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function removeAt(key: string) {
    setPending((prev) => {
      const target = prev.find((item) => item.key === key);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.key !== key);
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSend) return;

    const pendingText = text.trim();
    const pendingFiles = pending;

    setText('');
    setPending([]);
    setIsSending(true);

    try {
      await onSend({
        text: pendingText || undefined,
        attachmentKeys: pendingFiles.length > 0 ? pendingFiles.map((f) => f.key) : undefined,
      });
      for (const file of pendingFiles) {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
      }
    } catch {
      // Put it all back — a failed send must not silently eat what they wrote.
      setText(pendingText);
      setPending(pendingFiles);
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter is a newline.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit(event as unknown as FormEvent);
    }
  }

  if (blockedReason) {
    return (
      <div className="pb-safe border-t border-border px-4 py-4 text-center">
        <p className="text-sm text-muted-foreground">{blockedReason}</p>
      </div>
    );
  }

  return (
    <div className="pb-safe border-t border-border">
      {pending.length > 0 && (
        <div className="scrollbar-slim flex gap-2 overflow-x-auto border-b border-border px-4 py-2.5">
          {pending.map((item) => (
            <div key={item.key} className="relative shrink-0">
              {item.isImage && item.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.previewUrl}
                  alt={item.name}
                  className="h-16 w-16 rounded-lg border border-border object-cover"
                />
              ) : (
                <div className="flex h-16 w-40 items-center gap-2 rounded-lg border border-border bg-secondary px-2.5">
                  <Icon name="file" size={20} className="text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-foreground">{item.name}</p>
                    <p className="text-[10px] text-muted-foreground">{formatBytes(item.size)}</p>
                  </div>
                </div>
              )}

              <button
                onClick={() => removeAt(item.key)}
                aria-label={`Remove ${item.name}`}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow"
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-2 px-3 py-3 sm:px-4">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => void handlePick(Array.from(event.target.files ?? []))}
        />

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || isUploading}
          aria-label="Attach files"
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-input text-foreground transition hover:bg-secondary disabled:opacity-40'
          )}
        >
          {isUploading ? <Spinner size={18} /> : <Icon name="attach" size={19} />}
        </button>

        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onTyping();
          }}
          onKeyDown={handleKeyDown}
          rows={1}
          maxLength={2000}
          disabled={disabled}
          placeholder={disabled ? 'Connecting…' : 'Message'}
          aria-label="Message"
          className="scrollbar-slim max-h-32 flex-1 resize-none rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none disabled:opacity-60"
        />

        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send message"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {isSending ? <Spinner size={20} /> : <Icon name="send" size={20} />}
        </button>
      </form>
    </div>
  );
}
