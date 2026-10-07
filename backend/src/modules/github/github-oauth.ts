import type { GitHubAccessLevel } from '@lcsync/shared';
import { AppError } from '../../common/app-error.js';

/**
 * OAuth scopes requested per access level. OAuth Apps have no narrower repository scope:
 *  - public_repo: read/write public repositories only (create public repos, commit).
 *  - repo:        additionally private repositories. Only requested when the user opts in.
 * GitHub's /user endpoint works with any token, so no user-profile scope is needed.
 */
export const SCOPES_BY_ACCESS: Record<GitHubAccessLevel, string> = {
  public: 'public_repo',
  private: 'repo',
};

export function accessLevelFromScopes(scopes: readonly string[]): GitHubAccessLevel {
  return scopes.includes('repo') ? 'private' : 'public';
}

export interface OAuthTokenResult {
  accessToken: string;
  scopes: string[];
}

export interface GitHubOAuthClient {
  authorizeUrl(params: { state: string; scope: string; redirectUri: string }): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenResult>;
  /** Revokes the app's grant so the token stops working at GitHub. Best effort. */
  revokeGrant(accessToken: string): Promise<void>;
}

export class GitHubOAuthHttpClient implements GitHubOAuthClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  authorizeUrl({
    state,
    scope,
    redirectUri,
  }: {
    state: string;
    scope: string;
    redirectUri: string;
  }): string {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scope);
    url.searchParams.set('state', state);
    url.searchParams.set('allow_signup', 'true');
    return url.toString();
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokenResult> {
    let res: Response;
    try {
      res = await this.fetchImpl('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (cause) {
      throw new AppError(
        'GITHUB_UNAVAILABLE',
        'Could not reach GitHub to complete sign-in. Please try again.',
        { cause },
      );
    }
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !body.access_token) {
      throw new AppError(
        'GITHUB_AUTH_FAILED',
        body.error === 'bad_verification_code'
          ? 'The GitHub sign-in link expired. Please click "Connect GitHub" again.'
          : 'GitHub sign-in failed. Please try again.',
      );
    }
    const scopes = (body.scope ?? '')
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return { accessToken: body.access_token, scopes };
  }

  async revokeGrant(accessToken: string): Promise<void> {
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    await this.fetchImpl(`https://api.github.com/applications/${this.clientId}/grant`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        'User-Agent': 'leetcode-github-sync',
      },
      body: JSON.stringify({ access_token: accessToken }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => undefined);
  }
}
