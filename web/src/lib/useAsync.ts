import { useEffect, useState, type DependencyList } from 'react';

export interface Async<T> { data: T | undefined; error: string | null; loading: boolean }

export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): Async<T> & { reload: () => void } {
  const [state, set] = useState<Async<T>>({ data: undefined, error: null, loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    set(s => ({ ...s, loading: true, error: null }));
    fn().then(
      data => { if (live) set({ data, error: null, loading: false }); },
      e => { if (live) set({ data: undefined, error: e instanceof Error ? e.message : String(e), loading: false }); },
    );
    return () => { live = false; };
  }, [...deps, n]);
  return { ...state, reload: () => setN(x => x + 1) };
}
