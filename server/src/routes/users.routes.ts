import { Router } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import {
  acceptRequest,
  cancelRequest,
  declineRequest,
  describeUser,
  getMutuals,
  listFollowers,
  listFollowing,
  listIncomingRequests,
  requestFollow,
  searchUsers,
  setAvatar,
  unfollowUser,
} from '../services/user.service';
import { userRoom } from '../sockets/presence';

const searchSchema = z.object({
  q: z.string().trim().min(1, 'Search for a username').max(30),
});

/** `null` clears the photo and falls back to initials. */
const avatarSchema = z.object({
  avatarKey: z.string().trim().min(1).nullable(),
});

export function createUsersRouter(io: Server): Router {
  const router = Router();

  router.use(requireAuth);

  /**
   * Tell `otherId` how things now stand with `meId`.
   *
   * Note the arguments are flipped: the payload has to be built from THEIR point
   * of view, not ours. What we call "requestSent" is their "requestReceived".
   */
  async function notify(
    event: 'follow:request' | 'follow:update',
    meId: string,
    otherId: string
  ): Promise<void> {
    try {
      const asTheySeeMe = await describeUser(otherId, meId);
      io.to(userRoom(otherId)).emit(event, { user: asTheySeeMe });
    } catch (err) {
      console.error(`[api] could not emit ${event} to ${otherId}:`, err);
    }
  }

  /** GET /api/users/search?q=… */
  router.get('/search', async (req, res, next) => {
    try {
      const parsed = searchSchema.safeParse(req.query);
      if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);

      res.json({ success: true, data: await searchUsers(req.user!.id, parsed.data.q) });
    } catch (err) {
      next(err);
    }
  });

  /** PATCH /api/users/me/avatar — set or clear your profile photo. */
  router.patch('/me/avatar', async (req, res, next) => {
    try {
      const parsed = avatarSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, parsed.error.issues[0].message);

      res.json({ success: true, data: await setAvatar(req.user!.id, parsed.data.avatarKey) });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/users/requests — everyone waiting on your decision. */
  router.get('/requests', async (req, res, next) => {
    try {
      res.json({ success: true, data: await listIncomingRequests(req.user!.id) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/following', async (req, res, next) => {
    try {
      res.json({ success: true, data: await listFollowing(req.user!.id) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/followers', async (req, res, next) => {
    try {
      res.json({ success: true, data: await listFollowers(req.user!.id) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/mutuals', async (req, res, next) => {
    try {
      res.json({ success: true, data: await getMutuals(req.user!.id) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/users/:id/follow — ask to follow.
   *
   * Becomes a pending request, UNLESS they already follow you, in which case it
   * is applied immediately. `accepted` in the response says which happened, so
   * the UI can show "Requested" or "Following" without guessing.
   */
  router.post('/:id/follow', async (req, res, next) => {
    try {
      const meId = req.user!.id;
      const targetId = req.params.id;

      const { relationship, accepted } = await requestFollow(meId, targetId);

      // An instant follow is news ("you're now mutuals"); a pending one is a
      // request they have to act on. Different events, different UI.
      await notify(accepted ? 'follow:update' : 'follow:request', meId, targetId);

      res.status(accepted ? 200 : 201).json({
        success: true,
        data: { relationship, accepted },
      });
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/users/:id/follow — unfollow someone you already follow. */
  router.delete('/:id/follow', async (req, res, next) => {
    try {
      const meId = req.user!.id;
      const relationship = await unfollowUser(meId, req.params.id);
      await notify('follow:update', meId, req.params.id);

      res.json({ success: true, data: relationship });
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/users/:id/request — withdraw a request you sent. */
  router.delete('/:id/request', async (req, res, next) => {
    try {
      const meId = req.user!.id;
      const relationship = await cancelRequest(meId, req.params.id);
      await notify('follow:update', meId, req.params.id);

      res.json({ success: true, data: relationship });
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/users/:id/accept — let them follow you. */
  router.post('/:id/accept', async (req, res, next) => {
    try {
      const meId = req.user!.id;
      const relationship = await acceptRequest(meId, req.params.id);
      await notify('follow:update', meId, req.params.id);

      res.json({ success: true, data: relationship });
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/users/:id/decline */
  router.post('/:id/decline', async (req, res, next) => {
    try {
      const meId = req.user!.id;
      const relationship = await declineRequest(meId, req.params.id);
      await notify('follow:update', meId, req.params.id);

      res.json({ success: true, data: relationship });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/users/:id — must stay LAST, or it swallows /search, /requests, … */
  router.get('/:id', async (req, res, next) => {
    try {
      res.json({ success: true, data: await describeUser(req.user!.id, req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
