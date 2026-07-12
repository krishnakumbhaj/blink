import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import {
  MAX_FILES_PER_MESSAGE,
  MAX_UPLOAD_BYTES,
  getUpload,
  isInlineImage,
  storeUpload,
} from '../services/upload.service';

// Memory storage, not disk: the buffer goes straight into MongoDB, so writing it
// to a temp file first would only create something to clean up.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_FILES_PER_MESSAGE },
});

export function createUploadsRouter(): Router {
  const router = Router();

  /**
   * GET /api/uploads/:key — the file itself.
   *
   * Deliberately UNAUTHENTICATED. An `<img src>` cannot send an Authorization
   * header, so the URL has to be the credential: the key is 128 random bits and
   * is only ever handed to people who can already see the message it belongs to.
   *
   * The honest limit: anyone who obtains the URL can fetch it, forever, even
   * after being unfollowed. It is a capability, not an ACL.
   */
  router.get('/:key', async (req, res, next) => {
    try {
      const file = await getUpload(req.params.key);

      /**
       * `?download=1` forces a download of something that would otherwise render
       * inline — the Save button on a photo.
       *
       * This has to be done on the SERVER. The HTML `download` attribute is
       * ignored for cross-origin URLs, and the API is a different origin from the
       * app, so `<a download>` on a photo would simply open it in a tab. Only
       * Content-Disposition actually forces the save.
       */
      const wantsDownload = req.query.download === '1';

      // THE security decision on this route. Only known-safe image types are
      // ever rendered inline; everything else is forced to download regardless.
      // An HTML or SVG upload can carry script — but a downloaded file cannot
      // run in our origin.
      const inline = isInlineImage(file.contentType) && !wantsDownload;

      res.setHeader('Content-Type', inline ? file.contentType : 'application/octet-stream');
      res.setHeader('Content-Length', String(file.size));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        inline ? 'inline' : `attachment; filename="${file.name.replace(/"/g, '')}"`
      );
      // Safe to cache hard: the bytes never change for a given key, and the two
      // dispositions live at different URLs (`?download=1` is part of the cache
      // key), so the inline copy can never be served in place of the download.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

      res.send(file.data);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/uploads — multipart. Field `files`, one or many.
   *
   * Always returns an array, even for a single file, so the client has one code
   * path rather than two.
   */
  router.post('/', requireAuth, upload.array('files', MAX_FILES_PER_MESSAGE), async (req, res, next) => {
    try {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (files.length === 0) throw new ApiError(400, 'No files were uploaded');

      const stored = await Promise.all(
        files.map((file) =>
          storeUpload({
            ownerId: req.user!.id,
            buffer: file.buffer,
            contentType: file.mimetype,
            // Browsers send this latin1-encoded; without the round-trip a file
            // called "résumé.pdf" downloads as "rÃ©sumÃ©.pdf".
            name: Buffer.from(file.originalname, 'latin1').toString('utf8'),
          })
        )
      );

      res.status(201).json({ success: true, data: stored });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
