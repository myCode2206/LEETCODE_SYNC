import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ProblemSummaryDto, StatsDto } from '@lcsync/shared';
import { api } from '../services/api.js';
import { chromeStorage } from '../storage/storage.js';

const storage = chromeStorage();

interface PopupData {
  problems: ProblemSummaryDto[] | null;
  stats: StatsDto | null;
  loading: boolean;
  error: unknown;
  /** True when showing cached data because the server could not be reached. */
  offline: boolean;
  refresh: () => Promise<void>;
  /** Replace one problem locally after an edit (avoids a full reload). */
  patchProblem: (problem: ProblemSummaryDto) => void;
}

const Ctx = createContext<PopupData | null>(null);

/** Cache-first data: shows the last known problems/stats instantly, then refreshes. */
export function DataProvider({ children }: { children: ReactNode }) {
  const [problems, setProblems] = useState<ProblemSummaryDto[] | null>(null);
  const [stats, setStats] = useState<StatsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, s] = await Promise.all([api.listProblems(), api.stats()]);
      setProblems(p);
      setStats(s);
      setOffline(false);
      await storage.set('cachedProblems', p);
      await storage.set('cachedStats', s);
    } catch (err) {
      setError(err);
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const [p, s] = await Promise.all([storage.get('cachedProblems'), storage.get('cachedStats')]);
      if (p) setProblems(p);
      if (s) setStats(s);
      await refresh();
    })();
  }, [refresh]);

  const patchProblem = useCallback((updated: ProblemSummaryDto) => {
    setProblems(
      (list) => list?.map((p) => (p.slug === updated.slug ? { ...p, ...updated } : p)) ?? list,
    );
  }, []);

  const value = useMemo(
    () => ({ problems, stats, loading, error, offline, refresh, patchProblem }),
    [problems, stats, loading, error, offline, refresh, patchProblem],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): PopupData {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useData outside DataProvider');
  return ctx;
}
