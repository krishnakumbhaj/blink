import type { Request, Response, NextFunction } from 'express';
import { MulterError } from 'multer';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ success: false, message: 'Route not found' });
}

/**
 * Single funnel for every API failure, so clients always get the same JSON shape
 * instead of Express's default HTML error page.
 */
/**
 * Express only recognises this as ERROR middleware because it takes four
 * arguments. `_next` is never called, but removing it would silently turn this
 * into ordinary middleware and every error would fall through to a 404.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ success: false, message: err.message });
    return;
  }

  // Multer rejects an oversized file with its own error class, which would
  // otherwise be reported as a 500 — "the server broke" instead of "your file
  // is too big", which is the opposite of helpful.
  if (err instanceof MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'Images must be under 3 MB' : 'Could not read that file';
    res.status(413).json({ success: false, message });
    return;
  }

  console.error('[api] unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
}
