import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { isUsernameAvailable, login, register } from '../services/auth.service';
import { getUserOrThrow, toSelfDTO } from '../services/user.service';

const usernameValidation = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters long')
  .max(20, 'Username must be at most 20 characters long')
  .regex(/^[a-zA-Z0-9]+$/, 'Username must contain only letters and numbers');

const registerSchema = z.object({
  username: usernameValidation,
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Email or username is required'),
  password: z.string().min(1, 'Password is required'),
});

export function createAuthRouter(): Router {
  const router = Router();

  /** POST /api/auth/register — create an account and sign in immediately. */
  router.post('/register', async (req, res, next) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);

      const result = await register(parsed.data);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/auth/login — exchange credentials for a JWT. */
  router.post('/login', async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);

      const result = await login(parsed.data);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/auth/me — who does this token belong to?
   *
   * The client calls this on boot to decide whether a stored token is still good.
   * It reads the user fresh rather than echoing the token's claims, so a photo
   * changed on another device shows up here.
   */
  router.get('/me', requireAuth, async (req, res, next) => {
    try {
      const user = await getUserOrThrow(req.user!.id);
      res.json({ success: true, data: { user: toSelfDTO(user) } });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/auth/check-username?username=… — powers the live sign-up check. */
  router.get('/check-username', async (req, res, next) => {
    try {
      const parsed = usernameValidation.safeParse(req.query.username);
      if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);

      const available = await isUsernameAvailable(parsed.data);
      res.json({ success: true, data: { available } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
