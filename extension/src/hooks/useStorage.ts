import { useCallback, useEffect, useState } from 'react';
import { chromeStorage } from '../storage/storage.js';
import type { StorageKey, StorageSchema } from '../storage/storage.js';

const storage = chromeStorage();

/** Reads a storage key and re-renders when any extension context changes it. */
export function useStorage<K extends StorageKey>(
  key: K,
): [StorageSchema[K] | undefined, (v: StorageSchema[K]) => Promise<void>] {
  const [value, setValue] = useState<StorageSchema[K]>();

  useEffect(() => {
    let active = true;
    void storage.get(key).then((v) => active && setValue(v));
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && key in changes)
        void storage.get(key).then((v) => active && setValue(v));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [key]);

  const update = useCallback((v: StorageSchema[K]) => storage.set(key, v), [key]);
  return [value, update];
}
