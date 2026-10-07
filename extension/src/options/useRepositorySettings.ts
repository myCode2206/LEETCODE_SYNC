import { useState } from 'react';
import type { RepositorySettings } from '@lcsync/shared';
import { api } from '../services/api.js';
import { chromeStorage } from '../storage/storage.js';
import { errorMessage } from '../utils/errors.js';

const storage = chromeStorage();

/** Saves backend repository settings immediately and keeps the cached account in sync. */
export function useRepositorySettings() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Partial<RepositorySettings>) => {
    setSaving(true);
    setError(null);
    try {
      const repository = await api.updateRepositorySettings(patch);
      const me = await storage.get('me');
      if (me) await storage.set('me', { ...me, repository });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return { save, saving, error };
}
