import { Router } from 'express';
import { z } from 'zod';
import {
  CreateRepositoryInputSchema,
  RepositoryConfigInputSchema,
  RepositorySettingsSchema,
} from '@lcsync/shared';
import { parse, param } from '../../common/http.js';
import { authOf } from '../auth/auth.middleware.js';
import { toRepositoryDto } from './repository.service.js';
import type { RepositoryService } from './repository.service.js';

/** /github/* — browse the user's GitHub repositories and branches. */
export function githubRoutes(repositories: RepositoryService): Router {
  const router = Router();

  router.get('/repositories', async (_req, res) => {
    res.json({ items: await repositories.listGitHubRepositories(authOf(res).userId) });
  });

  router.post('/repositories', async (req, res) => {
    const input = parse(CreateRepositoryInputSchema, req.body);
    res.status(201).json(await repositories.createGitHubRepository(authOf(res).userId, input));
  });

  router.get('/repositories/:id/branches', async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), param(req, 'id'));
    res.json({ items: await repositories.listBranches(authOf(res).userId, id) });
  });

  return router;
}

/** /repository — the active sync target and its settings. */
export function repositoryRoutes(repositories: RepositoryService): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const repo = await repositories.getActive(authOf(res).userId);
    res.json({ repository: repo ? toRepositoryDto(repo) : null });
  });

  router.put('/', async (req, res) => {
    const input = parse(RepositoryConfigInputSchema, req.body);
    res.json({ repository: await repositories.configure(authOf(res).userId, input) });
  });

  router.patch('/settings', async (req, res) => {
    const settings = parse(RepositorySettingsSchema.partial(), req.body);
    res.json({ repository: await repositories.updateSettings(authOf(res).userId, settings) });
  });

  return router;
}
