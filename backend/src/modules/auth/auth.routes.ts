import { Router } from 'express';
import { z } from 'zod';
import { GITHUB_ACCESS_LEVELS, TokenExchangeInputSchema } from '@lcsync/shared';
import { isAppError } from '../../common/app-error.js';
import { parse } from '../../common/http.js';
import { authOf, requireSession } from './auth.middleware.js';
import type { AuthService } from './auth.service.js';

const StartQuery = z.object({
  redirect_uri: z.string().min(1).max(500),
  access: z.enum(GITHUB_ACCESS_LEVELS).default('public'),
});

const CallbackQuery = z.object({
  code: z.string().max(200).optional(),
  state: z.string().max(200).optional(),
  error: z.string().max(100).optional(),
});

function errorPage(message: string): string {
  const safe = message.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><meta charset="utf-8"><title>Sign-in failed</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h1>GitHub sign-in failed</h1><p>${safe}</p><p>You can close this window and try again from the extension.</p></body>`;
}

export function authRoutes(auth: AuthService): Router {
  const router = Router();

  router.get('/github', async (req, res) => {
    const q = parse(StartQuery, req.query);
    res.redirect(302, await auth.startLogin(q.redirect_uri, q.access));
  });

  // Pre-flight for the extension: launchWebAuthFlow hides HTTP errors behind a generic
  // "page could not be loaded", so the extension checks reachability and its redirect URI here.
  router.get('/github/check', (req, res) => {
    const q = parse(StartQuery, req.query);
    auth.validateRedirectUri(q.redirect_uri);
    res.status(204).end();
  });

  router.get('/github/callback', async (req, res) => {
    const q = parse(CallbackQuery, req.query);
    try {
      res.redirect(302, await auth.completeLogin(q));
    } catch (err) {
      if (!isAppError(err)) throw err;
      res.status(400).type('html').send(errorPage(err.message));
    }
  });

  router.post('/token', async (req, res) => {
    const { code } = parse(TokenExchangeInputSchema, req.body);
    res.json(await auth.exchangeCode(code));
  });

  router.get('/me', requireSession(auth), async (_req, res) => {
    res.json(await auth.me(authOf(res).userId));
  });

  router.post('/logout', requireSession(auth), async (_req, res) => {
    await auth.logout(authOf(res).sessionId);
    res.status(204).end();
  });

  router.delete('/github', requireSession(auth), async (_req, res) => {
    await auth.disconnect(authOf(res).userId);
    res.status(204).end();
  });

  return router;
}
