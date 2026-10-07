import type { Kysely } from 'kysely';
import type { GitHubAccountDto } from '@lcsync/shared';
import { AppError, isAppError } from '../../common/app-error.js';
import { decryptSecret, encryptSecret } from '../../common/crypto.js';
import type { Database } from '../../database/schema.js';
import type { GitHubApi, GitHubUser } from './github-api.js';
import { accessLevelFromScopes } from './github-oauth.js';

export type GitHubApiFactory = (accessToken: string) => GitHubApi;

/** Owns the encrypted GitHub token. The only place it is ever decrypted. */
export class GitHubAccountService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly encryptionKey: Buffer,
    private readonly apiFactory: GitHubApiFactory,
  ) {}

  async getAccountDto(userId: string): Promise<GitHubAccountDto | null> {
    const row = await this.db
      .selectFrom('github_accounts')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!row) return null;
    const scopes = row.scopes ? row.scopes.split(',') : [];
    return {
      login: row.login,
      avatarUrl: row.avatar_url,
      scopes,
      accessLevel: accessLevelFromScopes(scopes),
      needsReconnect: row.needs_reconnect,
    };
  }

  async getScopes(userId: string): Promise<string[]> {
    return (await this.getAccountDto(userId))?.scopes ?? [];
  }

  /**
   * Runs `fn` with an API client for the user. If GitHub reports the token as invalid, the
   * account is flagged so the UI can ask the user to reconnect.
   */
  async withApi<T>(userId: string, fn: (api: GitHubApi) => Promise<T>): Promise<T> {
    const row = await this.db
      .selectFrom('github_accounts')
      .select(['access_token_encrypted', 'needs_reconnect'])
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!row)
      throw new AppError(
        'GITHUB_NOT_CONNECTED',
        'GitHub is not connected. Click "Connect GitHub" to continue.',
      );
    if (row.needs_reconnect) {
      throw new AppError(
        'GITHUB_AUTH_EXPIRED',
        'GitHub authorization has expired. Please reconnect GitHub.',
      );
    }
    let token: string;
    try {
      token = decryptSecret(row.access_token_encrypted, this.encryptionKey);
    } catch (cause) {
      // Key rotated or data corrupted: the only fix is to sign in again.
      await this.markNeedsReconnect(userId);
      throw new AppError(
        'GITHUB_AUTH_EXPIRED',
        'GitHub authorization is no longer valid. Please reconnect GitHub.',
        {
          cause,
        },
      );
    }
    try {
      return await fn(this.apiFactory(token));
    } catch (err) {
      if (isAppError(err) && err.code === 'GITHUB_AUTH_EXPIRED')
        await this.markNeedsReconnect(userId);
      throw err;
    }
  }

  async decryptTokenForRevocation(userId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('github_accounts')
      .select('access_token_encrypted')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!row) return null;
    try {
      return decryptSecret(row.access_token_encrypted, this.encryptionKey);
    } catch {
      return null;
    }
  }

  private async markNeedsReconnect(userId: string): Promise<void> {
    await this.db
      .updateTable('github_accounts')
      .set({ needs_reconnect: true, updated_at: new Date() })
      .where('user_id', '=', userId)
      .execute();
  }

  /**
   * Finds or creates the user for a GitHub identity. Keyed by GitHub's numeric user id, so a
   * renamed GitHub account keeps its data; the login is refreshed on every sign-in.
   */
  async upsertFromOAuth(
    ghUser: GitHubUser,
    accessToken: string,
    scopes: string[],
  ): Promise<string> {
    const encrypted = encryptSecret(accessToken, this.encryptionKey);
    return this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('github_accounts')
        .select('user_id')
        .where('github_user_id', '=', ghUser.id)
        .executeTakeFirst();
      if (existing) {
        await trx
          .updateTable('github_accounts')
          .set({
            login: ghUser.login,
            avatar_url: ghUser.avatarUrl,
            access_token_encrypted: encrypted,
            scopes: scopes.join(','),
            needs_reconnect: false,
            updated_at: new Date(),
          })
          .where('github_user_id', '=', ghUser.id)
          .execute();
        return existing.user_id;
      }
      const user = await trx
        .insertInto('users')
        .defaultValues()
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('github_accounts')
        .values({
          user_id: user.id,
          github_user_id: ghUser.id,
          login: ghUser.login,
          avatar_url: ghUser.avatarUrl,
          access_token_encrypted: encrypted,
          scopes: scopes.join(','),
        })
        .execute();
      return user.id;
    });
  }

  async disconnect(userId: string): Promise<void> {
    await this.db.deleteFrom('github_accounts').where('user_id', '=', userId).execute();
  }
}
