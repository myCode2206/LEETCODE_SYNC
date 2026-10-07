import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { API_PREFIX } from '@lcsync/shared';
import { AppError } from './common/app-error.js';
import { errorHandler, notFoundHandler } from './common/http.js';
import type { Container } from './container.js';
import { requireSession } from './modules/auth/auth.middleware.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { problemRoutes } from './modules/problems/problems.routes.js';
import { githubRoutes, repositoryRoutes } from './modules/repository/repository.routes.js';
import { revisionRoutes } from './modules/revisions/revisions.routes.js';
import { statsRoutes } from './modules/stats/stats.routes.js';
import { syncRoutes } from './modules/sync/sync.routes.js';

function limiter(limit: number) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res
        .status(429)
        .json(new AppError('RATE_LIMITED', 'Too many requests. Please slow down.').toBody());
    },
  });
}

export function createApp(c: Container, options: { trustProxy?: boolean | number } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (options.trustProxy) app.set('trust proxy', options.trustProxy);

  app.use(helmet());
  // Only the configured extension(s) may call the API from a browser context.
  const allowed = new Set(c.config.allowedExtensionIds.map((id) => `chrome-extension://${id}`));
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const ok =
          allowed.has(origin) ||
          (allowed.size === 0 &&
            c.config.env !== 'production' &&
            origin.startsWith('chrome-extension://'));
        cb(null, ok);
      },
      allowedHeaders: ['Authorization', 'Content-Type'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '512kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const api = express.Router();
  api.use('/auth', limiter(30), authRoutes(c.auth));

  const authed = express.Router();
  authed.use(limiter(300), requireSession(c.auth));
  authed.use('/github', githubRoutes(c.repositories));
  authed.use('/repository', repositoryRoutes(c.repositories));
  authed.use('/sync', syncRoutes(c.sync, c.jobs));
  authed.use('/problems', problemRoutes(c.problems));
  authed.use('/revisions', revisionRoutes(c.revisions));
  authed.use('/', statsRoutes(c.stats));
  api.use(authed);

  app.use(API_PREFIX, api);
  app.use(notFoundHandler);
  app.use(errorHandler(c.logger));
  return app;
}
