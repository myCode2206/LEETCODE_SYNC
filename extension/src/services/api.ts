import { chromeStorage } from '../storage/storage.js';
import { ApiClient, ApiError } from './api-client.js';

const storage = chromeStorage();

/** API client for extension pages; an expired session is cleared so the UI asks to reconnect. */
export const api = new ApiClient(
  async () => (await storage.get('session'))?.token ?? null,
  undefined,
  async (...args) => {
    const res = await fetch(...args);
    if (res.status === 401) {
      const body = (await res
        .clone()
        .json()
        .catch(() => null)) as { error?: { code?: string } } | null;
      if (body?.error?.code === 'UNAUTHENTICATED') {
        await storage.set('session', null);
        await storage.set('me', null);
      }
    }
    return res;
  },
);

export { ApiError };
