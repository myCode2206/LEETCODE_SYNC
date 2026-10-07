import { Router } from 'express';
import { z } from 'zod';
import { SyncProblemRequestSchema } from '@lcsync/shared';
import { parse } from '../../common/http.js';
import { authOf } from '../auth/auth.middleware.js';
import type { SyncJobStore } from './sync-jobs.js';
import type { SyncService } from './sync.service.js';

export function syncRoutes(sync: SyncService, jobs: SyncJobStore): Router {
  const router = Router();

  router.post('/problem', async (req, res) => {
    const body = parse(SyncProblemRequestSchema, req.body);
    const result = await sync.syncSubmission(authOf(res).userId, body);
    res.status(result.duplicate ? 200 : 201).json(result);
  });

  router.post('/pending', async (_req, res) => {
    res.json(await sync.pushPending(authOf(res).userId));
  });

  router.post('/full', async (_req, res) => {
    res.json(await sync.fullSync(authOf(res).userId));
  });

  router.get('/jobs', async (req, res) => {
    const { limit } = parse(
      z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
      req.query,
    );
    res.json({ items: await jobs.listRecent(authOf(res).userId, limit) });
  });

  return router;
}
