import type { GitHubAccessLevel, MeDto, ProblemSummaryDto, StatsDto } from '@lcsync/shared';
import type { LocalSyncRecord } from '../types/messages.js';
import type { QueueItem } from './queue-types.js';
import { DEFAULT_SETTINGS } from './settings.js';
import type { ExtensionSettings } from './settings.js';

/**
 * Everything the extension keeps locally (chrome.storage.local). Nothing here is a GitHub
 * credential: the session is a revocable token for our backend only.
 */
/** A sign-in link waiting to be approved (possibly in another browser or profile). */
export interface PendingLogin {
  url: string;
  code: string;
  pollToken: string;
  expiresAt: string;
  access: GitHubAccessLevel;
  /** Set when the link can no longer complete (expired, rejected). */
  error: string | null;
}

export interface StorageSchema {
  session: { token: string; expiresAt: string } | null;
  me: MeDto | null;
  pendingLogin: PendingLogin | null;
  settings: ExtensionSettings;
  syncQueue: QueueItem[];
  recentSyncs: LocalSyncRecord[];
  /** Submission ids already handled, so repeated detections are ignored. */
  seenSubmissions: string[];
  /** Offline cache for the popup. */
  cachedStats: StatsDto | null;
  cachedProblems: ProblemSummaryDto[] | null;
  popupTab: string;
}

const DEFAULTS: StorageSchema = {
  session: null,
  me: null,
  pendingLogin: null,
  settings: DEFAULT_SETTINGS,
  syncQueue: [],
  recentSyncs: [],
  seenSubmissions: [],
  cachedStats: null,
  cachedProblems: null,
  popupTab: 'dashboard',
};

export type StorageKey = keyof StorageSchema;

/** Minimal async key-value interface (chrome.storage.local in the extension, a Map in tests). */
export interface KeyValueArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export class TypedStorage {
  constructor(private readonly area: KeyValueArea) {}

  async get<K extends StorageKey>(key: K): Promise<StorageSchema[K]> {
    const result = await this.area.get([key]);
    const value = result[key] as StorageSchema[K] | undefined;
    if (value === undefined) return DEFAULTS[key];
    if (key === 'settings')
      return { ...DEFAULT_SETTINGS, ...(value as ExtensionSettings) } as StorageSchema[K];
    return value;
  }

  async set<K extends StorageKey>(key: K, value: StorageSchema[K]): Promise<void> {
    await this.area.set({ [key]: value });
  }

  async update<K extends StorageKey>(
    key: K,
    fn: (current: StorageSchema[K]) => StorageSchema[K],
  ): Promise<StorageSchema[K]> {
    const next = fn(await this.get(key));
    await this.set(key, next);
    return next;
  }
}

export function chromeStorage(): TypedStorage {
  return new TypedStorage(chrome.storage.local as unknown as KeyValueArea);
}

export function memoryArea(): KeyValueArea & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(keys) {
      return Object.fromEntries(
        keys.filter((k) => data.has(k)).map((k) => [k, structuredClone(data.get(k))]),
      );
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
    },
  };
}
