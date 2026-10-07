import { Router } from 'express';
import { CreateRevisionInputSchema } from '@lcsync/shared';
import { parse } from '../../common/http.js';
import { authOf } from '../auth/auth.middleware.js';
import type { RevisionService } from './revision.service.js';

export function revisionRoutes(revisions: RevisionService): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const input = parse(CreateRevisionInputSchema, req.body);
    res.status(201).json(await revisions.addRevision(authOf(res).userId, input));
  });

  router.get('/due', async (_req, res) => {
    res.json({ items: await revisions.due(authOf(res).userId) });
  });

  return router;
}
