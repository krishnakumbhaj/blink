import path from 'path';
import { Types } from 'mongoose';
import UploadModel, { generateUploadKey } from '../models/Upload';
import { ApiError } from '../middleware/errorHandler';
import type { AttachmentDTO } from '../types';

/**
 * The only types we will ever render **inline** in a browser.
 *
 * Everything else is served with `Content-Disposition: attachment`, which forces
 * a download instead of executing in our origin. That is what makes it safe to
 * accept arbitrary files at all: an HTML or SVG upload can carry script, but a
 * downloaded one cannot run against us.
 */
const INLINE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_FILES_PER_MESSAGE = 10;

export function isInlineImage(contentType: string): boolean {
  return INLINE_IMAGE_TYPES.has(contentType);
}

export interface StoredUpload {
  key: string;
  /** Relative — the client prefixes it with the server origin. */
  url: string;
  name: string;
  contentType: string;
  size: number;
  isImage: boolean;
}

export function uploadUrl(key: string): string {
  return `/api/uploads/${key}`;
}

/** Strip any path components — a filename is never a path. */
function safeName(raw: string | undefined): string {
  const base = path.basename(raw ?? 'file').trim();
  return (base || 'file').slice(0, 200);
}

export async function storeUpload(params: {
  ownerId: string;
  buffer: Buffer;
  contentType: string;
  name?: string;
}): Promise<StoredUpload> {
  if (params.buffer.length === 0) {
    throw new ApiError(400, 'The file is empty');
  }

  if (params.buffer.length > MAX_UPLOAD_BYTES) {
    throw new ApiError(413, 'Files must be under 8 MB');
  }

  const key = generateUploadKey();
  const contentType = params.contentType || 'application/octet-stream';
  const name = safeName(params.name);

  await UploadModel.create({
    key,
    ownerId: new Types.ObjectId(params.ownerId),
    data: params.buffer,
    contentType,
    name,
    size: params.buffer.length,
  });

  return {
    key,
    url: uploadUrl(key),
    name,
    contentType,
    size: params.buffer.length,
    isImage: isInlineImage(contentType),
  };
}

export async function getUpload(key: string) {
  const upload = await UploadModel.findOne({ key });
  if (!upload) throw new ApiError(404, 'File not found');
  return upload;
}

/**
 * Resolve upload keys into the metadata a message stores.
 *
 * The metadata is denormalised onto the message so that reading a thread never
 * has to join back to the uploads collection — and so a message keeps its
 * filename even if the upload is later cleaned up.
 */
export async function resolveAttachments(
  keys: string[],
  ownerId: string
): Promise<AttachmentDTO[]> {
  if (keys.length === 0) return [];

  if (keys.length > MAX_FILES_PER_MESSAGE) {
    throw new ApiError(400, `You can attach at most ${MAX_FILES_PER_MESSAGE} files`);
  }

  const uploads = await UploadModel.find({ key: { $in: keys } })
    .select('key ownerId name contentType size')
    .lean();

  const byKey = new Map(uploads.map((u) => [u.key, u]));

  return keys.map((key) => {
    const upload = byKey.get(key);
    if (!upload) throw new ApiError(404, 'One of those files no longer exists');

    // Otherwise you could paste someone else's upload key onto your own message.
    if (String(upload.ownerId) !== ownerId) {
      throw new ApiError(403, 'That file is not yours');
    }

    return {
      key: upload.key,
      url: uploadUrl(upload.key),
      name: upload.name,
      contentType: upload.contentType,
      size: upload.size,
      isImage: isInlineImage(upload.contentType),
    };
  });
}

/** An avatar must be a real image, not a PDF named `.png`. */
export async function assertOwnedImage(key: string, ownerId: string): Promise<void> {
  const upload = await UploadModel.findOne({ key }).select('ownerId contentType').lean();

  if (!upload) throw new ApiError(404, 'Image not found');

  if (String(upload.ownerId) !== ownerId) {
    throw new ApiError(403, 'That image is not yours');
  }

  if (!isInlineImage(upload.contentType)) {
    throw new ApiError(415, 'Your profile photo must be a JPEG, PNG, WebP or GIF');
  }
}
