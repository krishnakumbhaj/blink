/**
 * Downscale and re-encode an image in the browser, before it is ever uploaded.
 *
 * A photo straight off a phone is routinely 4–8 MB and 4000px wide. Sending that
 * to be displayed in a 300px bubble wastes the user's data, blows past the
 * server's 3 MB limit, and stores a needlessly enormous blob forever. Doing the
 * work here means the server needs no image library at all (no `sharp`, no
 * native build step on Render) and the upload is typically 100–400 KB.
 */

/** `maxSize` is the longest edge, in pixels. */
const PRESETS = {
  /** Displayed at most 96px, but retina and future-proofing want headroom. */
  avatar: { maxSize: 512, quality: 0.85 },
  /** Displayed at most ~380px in a bubble; 1600 allows a full-screen preview. */
  message: { maxSize: 1600, quality: 0.82 },
} as const;

export type CompressPreset = keyof typeof PRESETS;

export class ImageError extends Error {}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Prepare any file for upload.
 *
 * Photos get downscaled and re-encoded. Everything else — PDFs, zips, whatever —
 * is passed through untouched, because there is nothing useful to do to it in a
 * browser and mangling it would be worse than sending it as-is.
 */
export async function prepareFile(file: File, preset: CompressPreset): Promise<File> {
  if (!file.type.startsWith('image/')) {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ImageError(`${file.name} is over 8 MB`);
    }
    return file;
  }

  return compressImage(file, preset);
}

/** Accepts an image; returns a smaller one of the same shape. */
export async function compressImage(file: File, preset: CompressPreset): Promise<File> {
  if (!file.type.startsWith('image/')) {
    throw new ImageError('That file is not an image');
  }

  // GIFs are usually animated, and drawing one to a canvas would silently throw
  // away every frame but the first. Pass them through untouched.
  if (file.type === 'image/gif') {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ImageError('GIFs must be under 8 MB');
    }
    return file;
  }

  // SVG is an image to the browser but a document to a canvas — and it can carry
  // script. The server refuses to serve it inline; send it as a plain file.
  if (file.type === 'image/svg+xml') {
    return file;
  }

  const { maxSize, quality } = PRESETS[preset];
  const bitmap = await loadBitmap(file);

  try {
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) throw new ImageError('Could not process that image');

    context.drawImage(bitmap, 0, 0, width, height);

    // WebP where the browser has it (roughly 30% smaller than JPEG at the same
    // quality), JPEG otherwise. Never PNG — a photo as PNG is enormous.
    const type = canvas.toDataURL('image/webp').startsWith('data:image/webp')
      ? 'image/webp'
      : 'image/jpeg';

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, quality)
    );

    if (!blob) throw new ImageError('Could not process that image');

    const extension = type === 'image/webp' ? 'webp' : 'jpg';
    return new File([blob], `upload.${extension}`, { type });
  } finally {
    bitmap.close();
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new ImageError('That image could not be read');
  }
}
