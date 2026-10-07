import type { Kysely } from 'kysely';
import type {
  GitHubAccessLevel,
  LoginLinkDto,
  LoginLinkPollDto,
  MeDto,
  SessionDto,
} from '@lcsync/shared';
import { AppError } from '../../common/app-error.js';
import type { Clock } from '../../common/clock.js';
import { randomToken, sha256Hex } from '../../common/crypto.js';
import type { Logger } from '../../common/logger.js';
import type { Database } from '../../database/schema.js';
import type { GitHubAccountService, GitHubApiFactory } from '../github/github-account.service.js';
import { SCOPES_BY_ACCESS } from '../github/github-oauth.js';
import type { GitHubOAuthClient } from '../github/github-oauth.js';
import type { RepositoryService } from '../repository/repository.service.js';
import { toRepositoryDto } from '../repository/repository.service.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const AUTH_CODE_TTL_MS = 2 * 60 * 1000;
const LINK_TTL_MS = 15 * 60 * 1000;
/** oauth_states.redirect_uri marker for logins started from a sign-in link. */
const LINK_TARGET_PREFIX = 'link:';
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_PREFIX = 'lcs_';

export interface AuthConfig {
  publicBaseUrl: string;
  allowedExtensionIds: string[];
  sessionTtlDays: number;
  env: 'development' | 'test' | 'production';
}

/** What the OAuth callback should do: send the browser to the extension, or show a page. */
export type LoginOutcome =
  { kind: 'redirect'; url: string } | { kind: 'page'; ok: boolean; message: string };

export interface AuthContext {
  userId: string;
  sessionId: string;
}

/**
 * OAuth flow (no GitHub token ever reaches the browser):
 *  1. Extension opens /auth/github?redirect_uri=https://<ext-id>.chromiumapp.org/… via
 *     chrome.identity.launchWebAuthFlow. We store a hashed one-time `state` and redirect to GitHub.
 *  2. GitHub redirects to /auth/github/callback. We verify `state`, exchange the code for a token
 *     (server-side, with the client secret), encrypt it, and redirect to the extension with a
 *     short-lived one-time `code`.
 *  3. The extension POSTs that code to /auth/token and receives a revocable session token.
 *
 * Sign-in links (for a GitHub login that lives in another browser or profile) replace 1 and 3:
 * the extension creates a link and polls it; the link page shows a confirmation code, then
 * starts the same OAuth flow; the callback marks the link complete instead of redirecting, and
 * the next poll returns a session.
 */
export class AuthService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly config: AuthConfig,
    private readonly oauth: GitHubOAuthClient,
    private readonly apiFactory: GitHubApiFactory,
    private readonly accounts: GitHubAccountService,
    private readonly repositories: RepositoryService,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  get callbackUrl(): string {
    return `${this.config.publicBaseUrl}/api/v1/auth/github/callback`;
  }

  /** Only https://<allowed-extension-id>.chromiumapp.org/... may receive the login code. */
  validateRedirectUri(raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new AppError('VALIDATION_FAILED', 'Invalid redirect_uri.');
    }
    const match = /^([a-p]{32})\.chromiumapp\.org$/.exec(url.hostname);
    const allowed = this.config.allowedExtensionIds;
    const idAllowed =
      !!match &&
      (allowed.includes(match[1]!) || (allowed.length === 0 && this.config.env !== 'production'));
    if (url.protocol !== 'https:' || !idAllowed || url.username || url.password) {
      throw new AppError('VALIDATION_FAILED', 'redirect_uri is not an allowed extension URL.');
    }
    return url;
  }

  /** Sign-in links may only be created by an allowed extension (defence in depth over CORS). */
  assertExtensionOrigin(origin: string | undefined): void {
    const allowed = this.config.allowedExtensionIds;
    if (allowed.length === 0 && this.config.env !== 'production') return;
    const id = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin ?? '')?.[1];
    if (!id || !allowed.includes(id)) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Sign-in links can only be created by the extension.',
      );
    }
  }

  async startLogin(redirectUri: string, access: GitHubAccessLevel): Promise<string> {
    const target = this.validateRedirectUri(redirectUri);
    return this.beginOAuth(target.toString(), access);
  }

  private async beginOAuth(target: string, access: GitHubAccessLevel): Promise<string> {
    const state = randomToken(32);
    const now = this.clock.now();
    await this.db.deleteFrom('oauth_states').where('expires_at', '<', now).execute();
    await this.db
      .insertInto('oauth_states')
      .values({
        state_hash: sha256Hex(state),
        redirect_uri: target,
        access_level: access,
        expires_at: new Date(now.getTime() + STATE_TTL_MS),
      })
      .execute();
    return this.oauth.authorizeUrl({
      state,
      scope: SCOPES_BY_ACCESS[access],
      redirectUri: this.callbackUrl,
    });
  }

  /** Creates a sign-in link that can be opened in any browser. */
  async createLoginLink(access: GitHubAccessLevel): Promise<LoginLinkDto> {
    const now = this.clock.now();
    await this.db
      .deleteFrom('login_links')
      .where('expires_at', '<', new Date(now.getTime() - LINK_TTL_MS))
      .execute();
    const linkToken = randomToken(24);
    const pollToken = randomToken(32);
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS);
    await this.db
      .insertInto('login_links')
      .values({
        link_hash: sha256Hex(linkToken),
        poll_hash: sha256Hex(pollToken),
        access_level: access,
        expires_at: expiresAt,
      })
      .execute();
    return {
      url: `${this.config.publicBaseUrl}/api/v1/auth/github/link/${linkToken}`,
      code: linkCode(linkToken),
      pollToken,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Validates a sign-in link; returns the code the page shows for the user to compare. */
  async describeLoginLink(linkToken: string): Promise<{ code: string }> {
    await this.openLink(linkToken);
    return { code: linkCode(linkToken) };
  }

  /** Starts GitHub OAuth for a sign-in link (after the user confirmed the code). */
  async startLinkLogin(linkToken: string): Promise<string> {
    const link = await this.openLink(linkToken);
    return this.beginOAuth(LINK_TARGET_PREFIX + link.link_hash, link.access_level);
  }

  private async openLink(linkToken: string) {
    const link = await this.db
      .selectFrom('login_links')
      .selectAll()
      .where('link_hash', '=', sha256Hex(linkToken))
      .executeTakeFirst();
    if (!link || link.expires_at < this.clock.now()) {
      throw new AppError(
        'VALIDATION_FAILED',
        'This sign-in link has expired. Create a new one from the extension.',
      );
    }
    if (link.completed_at) {
      throw new AppError(
        'VALIDATION_FAILED',
        'This sign-in link was already used. Return to the extension.',
      );
    }
    return link;
  }

  /** Polled by the extension. A completed link is claimed once and turned into a session. */
  async pollLoginLink(pollToken: string): Promise<LoginLinkPollDto> {
    const pollHash = sha256Hex(pollToken);
    const link = await this.db
      .selectFrom('login_links')
      .select(['completed_at', 'expires_at'])
      .where('poll_hash', '=', pollHash)
      .executeTakeFirst();
    const expired = (l: { expires_at: Date }) => l.expires_at < this.clock.now();
    if (!link || (!link.completed_at && expired(link))) {
      throw new AppError(
        'UNAUTHENTICATED',
        'The sign-in link expired before it was used. Please create a new one.',
      );
    }
    if (!link.completed_at) return { status: 'pending' };

    const claimed = await this.db
      .deleteFrom('login_links')
      .where('poll_hash', '=', pollHash)
      .where('completed_at', 'is not', null)
      .returning(['user_id'])
      .executeTakeFirst();
    if (!claimed?.user_id) {
      throw new AppError('UNAUTHENTICATED', 'This sign-in link was already used.');
    }
    return { status: 'complete', session: await this.createSession(claimed.user_id) };
  }

  /**
   * Handles GitHub's redirect: back to the extension with a one-time code (or an error), or, for
   * a sign-in link, a page telling the user to return to the extension. Throws if the state is
   * unknown — in that case we cannot safely redirect anywhere.
   */
  async completeLogin(params: {
    code?: string;
    state?: string;
    error?: string;
  }): Promise<LoginOutcome> {
    if (!params.state) throw new AppError('VALIDATION_FAILED', 'Missing OAuth state.');
    const row = await this.db
      .deleteFrom('oauth_states')
      .where('state_hash', '=', sha256Hex(params.state))
      .returningAll()
      .executeTakeFirst();
    if (!row || row.expires_at < this.clock.now()) {
      throw new AppError(
        'VALIDATION_FAILED',
        'This sign-in link has expired. Please start again from the extension.',
      );
    }
    if (row.redirect_uri.startsWith(LINK_TARGET_PREFIX)) {
      return this.completeLinkLogin(row.redirect_uri.slice(LINK_TARGET_PREFIX.length), params);
    }
    const back = new URL(row.redirect_uri);

    if (params.error || !params.code) {
      back.searchParams.set(
        'error',
        params.error === 'access_denied' ? 'access_denied' : 'github_error',
      );
      return { kind: 'redirect', url: back.toString() };
    }

    try {
      const userId = await this.signInWithGitHub(params.code);
      const code = randomToken(32);
      await this.db
        .insertInto('auth_codes')
        .values({
          code_hash: sha256Hex(code),
          user_id: userId,
          expires_at: new Date(this.clock.now().getTime() + AUTH_CODE_TTL_MS),
        })
        .execute();
      back.searchParams.set('code', code);
    } catch (err) {
      this.logger.warn('github login failed', { err });
      back.searchParams.set('error', 'sign_in_failed');
    }
    return { kind: 'redirect', url: back.toString() };
  }

  /** A failed attempt leaves the link pending, so the user can simply open it again. */
  private async completeLinkLogin(
    linkHash: string,
    params: { code?: string; error?: string },
  ): Promise<LoginOutcome> {
    const retry = 'Open the same link again to retry.';
    if (params.error || !params.code) {
      return {
        kind: 'page',
        ok: false,
        message:
          params.error === 'access_denied'
            ? `GitHub access was not granted. ${retry}`
            : `GitHub reported an error. ${retry}`,
      };
    }
    let userId: string;
    try {
      userId = await this.signInWithGitHub(params.code);
    } catch (err) {
      this.logger.warn('github login failed', { err });
      return { kind: 'page', ok: false, message: `GitHub sign-in failed. ${retry}` };
    }
    const now = this.clock.now();
    const done = await this.db
      .updateTable('login_links')
      .set({ user_id: userId, completed_at: now })
      .where('link_hash', '=', linkHash)
      .where('completed_at', 'is', null)
      .where('expires_at', '>', now)
      .returning('link_hash')
      .executeTakeFirst();
    if (!done) {
      return {
        kind: 'page',
        ok: false,
        message: 'This sign-in link expired. Create a new one from the extension.',
      };
    }
    return {
      kind: 'page',
      ok: true,
      message: 'GitHub is connected. You can close this tab and return to the extension.',
    };
  }

  private async signInWithGitHub(oauthCode: string): Promise<string> {
    const token = await this.oauth.exchangeCode(oauthCode, this.callbackUrl);
    const ghUser = await this.apiFactory(token.accessToken).getAuthenticatedUser();
    return this.accounts.upsertFromOAuth(ghUser, token.accessToken, token.scopes);
  }

  /** Exchanges the one-time login code for a session. */
  async exchangeCode(code: string): Promise<SessionDto> {
    const now = this.clock.now();
    const row = await this.db
      .updateTable('auth_codes')
      .set({ used_at: now })
      .where('code_hash', '=', sha256Hex(code))
      .where('used_at', 'is', null)
      .where('expires_at', '>', now)
      .returning(['user_id'])
      .executeTakeFirst();
    if (!row)
      throw new AppError(
        'UNAUTHENTICATED',
        'Sign-in code is invalid or expired. Please connect GitHub again.',
      );

    return this.createSession(row.user_id);
  }

  private async createSession(userId: string): Promise<SessionDto> {
    const now = this.clock.now();
    const sessionToken = SESSION_PREFIX + randomToken(32);
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlDays * DAY_MS);
    await this.db
      .insertInto('sessions')
      .values({
        user_id: userId,
        token_hash: sha256Hex(sessionToken),
        expires_at: expiresAt,
        last_used_at: now,
      })
      .execute();
    return { sessionToken, expiresAt: expiresAt.toISOString(), me: await this.me(userId) };
  }

  /** Resolves a bearer token. Sessions slide: used sessions are extended once half-expired. */
  async authenticate(bearer: string | undefined): Promise<AuthContext> {
    if (!bearer?.startsWith(SESSION_PREFIX)) {
      throw new AppError('UNAUTHENTICATED', 'Please connect GitHub to continue.');
    }
    const now = this.clock.now();
    const session = await this.db
      .selectFrom('sessions')
      .select(['id', 'user_id', 'expires_at'])
      .where('token_hash', '=', sha256Hex(bearer))
      .executeTakeFirst();
    if (!session || session.expires_at <= now) {
      throw new AppError(
        'UNAUTHENTICATED',
        'Your session has expired. Please connect GitHub again.',
      );
    }
    const ttl = this.config.sessionTtlDays * DAY_MS;
    if (session.expires_at.getTime() - now.getTime() < ttl / 2) {
      await this.db
        .updateTable('sessions')
        .set({ expires_at: new Date(now.getTime() + ttl), last_used_at: now })
        .where('id', '=', session.id)
        .execute();
    }
    return { userId: session.user_id, sessionId: session.id };
  }

  async me(userId: string): Promise<MeDto> {
    const repo = await this.repositories.getActive(userId);
    return {
      userId,
      github: await this.accounts.getAccountDto(userId),
      repository: repo ? toRepositoryDto(repo) : null,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.deleteFrom('sessions').where('id', '=', sessionId).execute();
  }

  /** Revokes the GitHub grant, deletes the stored token and signs out everywhere. Data is kept. */
  async disconnect(userId: string): Promise<void> {
    const token = await this.accounts.decryptTokenForRevocation(userId);
    if (token) await this.oauth.revokeGrant(token);
    await this.accounts.disconnect(userId);
    await this.db.deleteFrom('sessions').where('user_id', '=', userId).execute();
  }
}

/** Short code shown both in the extension and on the link page, e.g. "4F1A-9C2E". */
function linkCode(linkToken: string): string {
  const hex = sha256Hex(`code:${linkToken}`).slice(0, 8).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}
