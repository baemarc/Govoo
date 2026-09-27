import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, sb } from './supabase';

export function useAdmin(): { session: Session | null; isAdmin: boolean; ready: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setAdmin] = useState(false);
  const [ready, setReady] = useState(!configured);
  const [loaded, setLoaded] = useState(!configured);

  useEffect(() => {
    if (!configured) return;
    sb.auth.getSession().then(({ data }) => { setSession(data.session); setLoaded(true); });
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!configured || !loaded) return;
    if (!session) { setAdmin(false); setReady(true); return; }
    setReady(false);
    let live = true;
    sb.rpc('is_admin').then(({ data }) => { if (live) { setAdmin(data === true); setReady(true); } });
    return () => { live = false; };
  }, [session, loaded]);

  return { session, isAdmin, ready };
}
