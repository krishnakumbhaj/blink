'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';

import { ApiError, setAvatar, uploadFiles } from '@/lib/chat-api';
import { ImageError, compressImage } from '@/lib/image';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Icon, Spinner } from '@/components/ui/icon';
import Avatar from '@/components/chat/Avatar';

export default function ProfilePage() {
  const { user, token, updateUser, signOut } = useAuth();
  const { toast } = useToast();

  const [isBusy, setIsBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  async function handlePick(file: File) {
    if (!token) return;
    setIsBusy(true);

    try {
      // Compress first, upload second, then point the profile at the new key.
      // Three steps, because the upload endpoint is generic — it does not know
      // or care that this particular image is going to be an avatar.
      const compressed = await compressImage(file, 'avatar');
      const [stored] = await uploadFiles(token, [compressed]);
      updateUser(await setAvatar(token, stored.key));

      toast({ title: 'Photo updated' });
    } catch (error) {
      toast({
        title: 'Could not update your photo',
        description:
          error instanceof ImageError || error instanceof ApiError
            ? error.message
            : 'Please try another file.',
        variant: 'destructive',
      });
    } finally {
      setIsBusy(false);
      // Reset, or picking the same file twice fires no change event.
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleRemove() {
    if (!token) return;
    setIsBusy(true);

    try {
      updateUser(await setAvatar(token, null));
      toast({ title: 'Photo removed' });
    } catch (error) {
      toast({
        title: 'Could not remove your photo',
        description: error instanceof ApiError ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-3 sm:px-4">
        <Link
          href="/chat"
          aria-label="Back to messages"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground transition hover:bg-secondary md:hidden"
        >
          <Icon name="back" />
        </Link>
        <h1 className="text-base font-semibold text-foreground">Profile</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-sm flex-col items-center">
          <div className="relative">
            <Avatar username={user.username} avatarUrl={user.avatarUrl} size="xl" />

            <button
              onClick={() => fileRef.current?.click()}
              disabled={isBusy}
              aria-label="Change profile photo"
              className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-card transition hover:bg-primary/90 disabled:opacity-50"
            >
              {isBusy ? <Spinner size={16} /> : <Icon name="camera" size={17} />}
            </button>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handlePick(file);
            }}
          />

          <p className="mt-4 text-xl font-semibold text-foreground">{user.username}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {user.avatarUrl
              ? 'Tap the camera to change your photo.'
              : 'Add a photo, or keep your initial.'}
          </p>

          <div className="mt-6 flex w-full flex-col gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={isBusy}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              <Icon name="image" size={17} />
              {user.avatarUrl ? 'Change photo' : 'Upload a photo'}
            </button>

            {user.avatarUrl && (
              <button
                onClick={() => void handleRemove()}
                disabled={isBusy}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-input text-sm font-semibold text-foreground transition hover:bg-secondary disabled:opacity-50"
              >
                <Icon name="delete" size={17} />
                Remove photo
              </button>
            )}

            <button
              onClick={signOut}
              className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <Icon name="logout" size={17} />
              Sign out
            </button>
          </div>

          <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
            Photos are resized in your browser before upload — usually well under
            400&nbsp;KB, whatever you started with.
          </p>
        </div>
      </div>
    </div>
  );
}
