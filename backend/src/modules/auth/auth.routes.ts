import { Router } from 'express';
import { z } from 'zod';
import {
  API_PREFIX,
  GITHUB_ACCESS_LEVELS,
  LoginLinkInputSchema,
  LoginLinkPollInputSchema,
  TokenExchangeInputSchema,
} from '@lcsync/shared';
import { isAppError } from '../../common/app-error.js';
import { parse } from '../../common/http.js';
import { authOf, requireSession } from './auth.middleware.js';
import type { AuthService } from './auth.service.js';

const StartQuery = z.object({
  redirect_uri: z.string().min(1).max(500),
  access: z.enum(GITHUB_ACCESS_LEVELS).default('public'),
});

const LinkParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/) });

const CallbackQuery = z.object({
  code: z.string().max(200).optional(),
  state: z.string().max(200).optional(),
  error: z.string().max(100).optional(),
});

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escape(title)}</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">
<h1>${escape(title)}</h1>${body}</body>`;
}

function errorPage(message: string): string {
  return page(
    'GitHub sign-in failed',
    `<p>${escape(message)}</p><p>You can close this window and try again from the extension.</p>`,
  );
}

/** Asks the user to compare codes, so a link someone else sent cannot sign them in. */
function confirmPage(code: string, continueUrl: string): string {
  return page(
    'Connect LeetCode Sync to GitHub',
    `<p>Check that the extension shows this code:</p>
<p style="font:600 2rem ui-monospace,monospace;letter-spacing:.1em">${escape(code)}</p>
<p>Only continue if it matches and you started this sign-in yourself.</p>
<p><a href="${escape(continueUrl)}" style="display:inline-block;padding:.6rem 1.2rem;background:#1f6feb;color:#fff;border-radius:6px;text-decoration:none">Continue to GitHub</a></p>`,
  );
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
      const outcome = await auth.completeLogin(q);
      if (outcome.kind === 'redirect') return res.redirect(302, outcome.url);
      res
        .status(outcome.ok ? 200 : 400)
        .type('html')
        .send(
          outcome.ok
            ? page('GitHub connected', `<p>${escape(outcome.message)}</p>`)
            : errorPage(outcome.message),
        );
    } catch (err) {
      if (!isAppError(err)) throw err;
      res.status(400).type('html').send(errorPage(err.message));
    }
  });

  // Sign-in links: for a GitHub login that lives in another browser or profile.
  router.post('/github/link', async (req, res) => {
    auth.assertExtensionOrigin(req.get('origin'));
    const { access } = parse(LoginLinkInputSchema, req.body ?? {});
    res.status(201).json(await auth.createLoginLink(access));
  });

  router.post('/github/link/poll', async (req, res) => {
    const { pollToken } = parse(LoginLinkPollInputSchema, req.body);
    res.json(await auth.pollLoginLink(pollToken));
  });

  router.get('/github/link/:token', async (req, res) => {
    const { token } = parse(LinkParams, req.params);
    try {
      const { code } = await auth.describeLoginLink(token);
      res.type('html').send(confirmPage(code, `${API_PREFIX}/auth/github/link/${token}/continue`));
    } catch (err) {
      if (!isAppError(err)) throw err;
      res.status(400).type('html').send(errorPage(err.message));
    }
  });

  router.get('/github/link/:token/continue', async (req, res) => {
    const { token } = parse(LinkParams, req.params);
    try {
      res.redirect(302, await auth.startLinkLogin(token));
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
