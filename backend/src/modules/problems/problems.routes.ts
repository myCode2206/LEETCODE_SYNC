import { Router } from 'express';
import {
  ProblemListQuerySchema,
  SaveAttemptInputSchema,
  UpdateProblemInputSchema,
} from '@lcsync/shared';
import { parse, param } from '../../common/http.js';
import { authOf } from '../auth/auth.middleware.js';
import type { ProblemService } from './problem.service.js';

export function problemRoutes(problems: ProblemService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = parse(ProblemListQuerySchema, req.query);
    res.json({ items: await problems.list(authOf(res).userId, query) });
  });

  router.get('/:slug', async (req, res) => {
    res.json(await problems.detail(authOf(res).userId, param(req, 'slug')));
  });

  router.patch('/:slug', async (req, res) => {
    const input = parse(UpdateProblemInputSchema, req.body);
    res.json(await problems.update(authOf(res).userId, param(req, 'slug'), input));
  });

  router.post('/:slug/attempts', async (req, res) => {
    const input = parse(SaveAttemptInputSchema, req.body);
    res.status(201).json(await problems.saveAttempt(authOf(res).userId, param(req, 'slug'), input));
  });

  return router;
}
