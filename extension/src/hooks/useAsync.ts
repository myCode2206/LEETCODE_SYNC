import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
  setData: (data: T) => void;
}

/**
 * Runs `fn` on mount, whenever `deps` (primitives) change, and on reload(). Previous data stays visible while
 * a reload is in flight. Loading is derived (request token vs. settled token), so no state is
 * set synchronously inside the effect.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [reloads, setReloads] = useState(0);
  const [settled, setSettled] = useState<{
    token: string;
    data: T | undefined;
    error: unknown;
  } | null>(null);
  const fnRef = useRef(fn);
  useLayoutEffect(() => {
    fnRef.current = fn;
  });

  // Deps are primitives (ids, slugs), so a string key identifies a request.
  const token = `${JSON.stringify(deps)}#${reloads}`;

  useEffect(() => {
    let active = true;
    fnRef.current().then(
      (data) => active && setSettled({ token, data, error: null }),
      (error: unknown) => active && setSettled((prev) => ({ token, data: prev?.data, error })),
    );
    return () => {
      active = false;
    };
  }, [token]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);
  const setData = useCallback((data: T) => setSettled({ token, data, error: null }), [token]);
  const loading = settled?.token !== token;
  return { data: settled?.data, error: loading ? null : settled?.error, loading, reload, setData };
}
