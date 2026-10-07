import { Router } from 'express';
import { authOf } from '../auth/auth.middleware.js';
import type { StatsService } from './stats.service.js';

export function statsRoutes(stats: StatsService): Router {
  const router = Router();
  router.get('/stats', async (_req, res) => {
    res.json(await stats.stats(authOf(res).userId));
  });
  router.get('/topics', async (_req, res) => {
    res.json({ items: await stats.categories(authOf(res).userId, 'topics') });
  });
  router.get('/patterns', async (_req, res) => {
    res.json({ items: await stats.categories(authOf(res).userId, 'patterns') });
  });
  router.get('/tags', async (_req, res) => {
    res.json({ items: await stats.categories(authOf(res).userId, 'tags') });
  });
  return router;
}
