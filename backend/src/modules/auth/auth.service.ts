import type { Kysely } from 'kysely';
import type { GitHubAccessLevel, MeDto, SessionDto } from '@lcsync/shared';
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
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_PREFIX = 'lcs_';

export interface AuthConfig {
  publicBaseUrl: string;
  allowedExtensionIds: string[];
  sessionTtlDays: number;
  env: 'development' | 'test' | 'production';
}

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

  async startLogin(redirectUri: string, access: GitHubAccessLevel): Promise<string> {
    const target = this.validateRedirectUri(redirectUri);
    const state = randomToken(32);
    const now = this.clock.now();
    await this.db.deleteFrom('oauth_states').where('expires_at', '<', now).execute();
    await this.db
      .insertInto('oauth_states')
      .values({
        state_hash: sha256Hex(state),
        redirect_uri: target.toString(),
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

  /**
   * Handles GitHub's redirect. Returns the extension URL to redirect to (with a one-time code or
   * an error), or throws if the state is unknown — in that case we cannot safely redirect anywhere.
   */
  async completeLogin(params: { code?: string; state?: string; error?: string }): Promise<string> {
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
    const back = new URL(row.redirect_uri);

    if (params.error || !params.code) {
      back.searchParams.set(
        'error',
        params.error === 'access_denied' ? 'access_denied' : 'github_error',
      );
      return back.toString();
    }

    try {
      const token = await this.oauth.exchangeCode(params.code, this.callbackUrl);
      const ghUser = await this.apiFactory(token.accessToken).getAuthenticatedUser();
      const userId = await this.accounts.upsertFromOAuth(ghUser, token.accessToken, token.scopes);
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
    return back.toString();
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

    const sessionToken = SESSION_PREFIX + randomToken(32);
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlDays * DAY_MS);
    await this.db
      .insertInto('sessions')
      .values({
        user_id: row.user_id,
        token_hash: sha256Hex(sessionToken),
        expires_at: expiresAt,
        last_used_at: now,
      })
      .execute();
    return { sessionToken, expiresAt: expiresAt.toISOString(), me: await this.me(row.user_id) };
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
