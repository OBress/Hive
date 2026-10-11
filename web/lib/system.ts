'use client';

import { useCallback, useEffect, useState } from 'react';
import { serverUrl } from './auth';

// What the running server reports about itself: GET /api/health (provider, models, sign-in) and
// GET /api/env (which variables are set; names and booleans only, never values). Polled while a page is open.

export interface ServerHealth { ok: boolean; projects: number; provider: string; models: { agent: string; planner: string }; auth: boolean }
export type EnvStatus = Record<string, { set: boolean }>;
export interface SystemState {
  health: ServerHealth | null;
  env: EnvStatus | null;
  reachable: boolean | null;   // null until the first answer
  refresh: () => void;
}

const POLL_MS = 15000;

export function useSystem(): SystemState {
  const [health, setHealth] = useState<ServerHealth | null>(null);
  const [env, setEnv] = useState<EnvStatus | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);

  const refresh = useCallback(() => {
    const get = <T,>(path: string) => fetch(`${serverUrl()}${path}`).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(r.status)));
    Promise.all([get<ServerHealth>('/api/health'), get<EnvStatus>('/api/env')])
      .then(([h, e]) => { setHealth(h); setEnv(e); setReachable(true); })
      .catch(() => setReachable(false));
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return { health, env, reachable, refresh };
}

export const isSet = (env: EnvStatus | null, name: string) => !!env?.[name]?.set;

// POST /api/env is only accepted from the machine running the server.
export const serverIsLocal = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(serverUrl()).hostname);
