'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/icon';
import { downloadUrl, mediaUrl } from '@/lib/chat-api';
import { formatBytes, type Attachment } from '@/types/chat';
import { cn } from '@/lib/utils';

/**
 * Grid shape by count, the way every messenger does it: one photo fills the
 * bubble, two sit side by side, three or more tile in a square with the overflow
 * collapsed behind a "+N". Anything else looks like a bug.
 */
function gridClass(count: number): string {
  if (count === 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-2';
  return 'grid-cols-2';
}

const MAX_TILES = 4;

export default function Attachments({
  attachments,
  isOwn,
}: {
  attachments: Attachment[];
  isOwn: boolean;
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);

  const images = attachments.filter((a) => a.isImage);
  const files = attachments.filter((a) => !a.isImage);

  const visible = images.slice(0, MAX_TILES);
  const hidden = images.length - visible.length;

  // Arrow keys move through the album; Escape closes it.
  useEffect(() => {
    if (lightbox === null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightbox(null);
      if (event.key === 'ArrowRight') setLightbox((i) => (i === null ? null : (i + 1) % images.length));
      if (event.key === 'ArrowLeft')
        setLightbox((i) => (i === null ? null : (i - 1 + images.length) % images.length));
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [lightbox, images.length]);

  return (
    <>
      {images.length > 0 && (
        <div className={cn('grid gap-0.5 overflow-hidden rounded-xl', gridClass(visible.length))}>
          {visible.map((image, index) => {
            const isLastTile = index === MAX_TILES - 1 && hidden > 0;

            return (
              <div
                key={image.key}
                className={cn(
                  'group/tile relative',
                  // A single image keeps its aspect ratio; a grid is squared off,
                  // or the tiles never line up.
                  visible.length === 1 ? 'max-h-80' : 'aspect-square'
                )}
              >
                <button
                  onClick={() => setLightbox(index)}
                  aria-label={`Open ${image.name}`}
                  className="block h-full w-full"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mediaUrl(image.url)}
                    alt={image.name}
                    loading="lazy"
                    className={cn(
                      'h-full w-full cursor-zoom-in object-cover',
                      visible.length === 1 && 'max-h-80'
                    )}
                  />
                </button>

                {isLastTile && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 text-xl font-semibold text-white">
                    +{hidden}
                  </span>
                )}

                {/* Save. Points at ?download=1 rather than using the `download`
                    attribute, which browsers ignore cross-origin — and the API is
                    a different origin, so the plain attribute would just open the
                    photo in a tab. */}
                <a
                  href={downloadUrl(image.url)}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`Download ${image.name}`}
                  className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-lg bg-black/50 text-white opacity-0 backdrop-blur-sm transition hover:bg-black/70 group-hover/tile:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <Icon name="download" size={15} />
                </a>
              </div>
            );
          })}
        </div>
      )}

      {files.length > 0 && (
        <div className={cn('flex flex-col gap-1', images.length > 0 && 'mt-1')}>
          {files.map((file) => (
            <a
              key={file.key}
              href={downloadUrl(file.url)}
              className={cn(
                'flex items-center gap-2.5 rounded-xl px-3 py-2 transition',
                // Inside a black bubble the chip has to invert, or it disappears.
                isOwn
                  ? 'bg-primary-foreground/10 hover:bg-primary-foreground/20'
                  : 'bg-card hover:bg-card/70'
              )}
            >
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  isOwn ? 'bg-primary-foreground/15' : 'bg-secondary'
                )}
              >
                <Icon name="file" size={18} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{file.name}</span>
                <span className={cn('block text-[10px]', isOwn ? 'opacity-70' : 'text-muted-foreground')}>
                  {formatBytes(file.size)}
                </span>
              </span>

              <Icon name="download" size={16} className="shrink-0 opacity-70" />
            </a>
          ))}
        </div>
      )}

      {lightbox !== null && images[lightbox] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={images[lightbox].name}
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
        >
          <div className="absolute right-4 top-4 flex items-center gap-2">
            <a
              href={downloadUrl(images[lightbox].url)}
              onClick={(event) => event.stopPropagation()}
              aria-label={`Download ${images[lightbox].name}`}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            >
              <Icon name="download" size={19} />
            </a>

            <button
              onClick={() => setLightbox(null)}
              aria-label="Close"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            >
              <Icon name="close" size={20} />
            </button>
          </div>

          {images.length > 1 && (
            <>
              <span className="absolute left-1/2 top-5 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white">
                {lightbox + 1} / {images.length}
              </span>

              <button
                onClick={(event) => {
                  event.stopPropagation();
                  setLightbox((i) => (i === null ? null : (i - 1 + images.length) % images.length));
                }}
                aria-label="Previous"
                className="absolute left-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              >
                <Icon name="back" size={20} />
              </button>

              <button
                onClick={(event) => {
                  event.stopPropagation();
                  setLightbox((i) => (i === null ? null : (i + 1) % images.length));
                }}
                aria-label="Next"
                className="absolute right-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              >
                <Icon name="back" size={20} className="rotate-180" />
              </button>
            </>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mediaUrl(images[lightbox].url)}
            alt={images[lightbox].name}
            onClick={(event) => event.stopPropagation()}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </>
  );
}
