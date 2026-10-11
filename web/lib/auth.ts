'use client';

// Server config + Supabase GitHub sign-in. The server says whether auth is on and hands out the
// (public) Supabase URL and anon key, so the only place to configure anything is the server's .env.

import { useSyncExternalStore } from 'react';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { SERVER_PORT } from '@hive/shared/types';

export interface ServerConfig { auth: boolean; supabaseUrl?: string; supabaseAnonKey?: string; epoch: string }
// approved: null until the server has said; false = signed in but waiting for an admin to approve the account.
export interface AuthState { ready: boolean; auth: boolean; login: string | null; approved: boolean | null; error?: string }

// Where the server is: NEXT_PUBLIC_SERVER_URL when the app is hosted (set at build time, e.g. https://api.example.com);
// otherwise port 4000 on the page's own host, so localhost and a LAN IP both work.
export const serverUrl = () =>
  (process.env.NEXT_PUBLIC_SERVER_URL ?? '').replace(/\/+$/, '') || `http://${window.location.hostname}:${SERVER_PORT}`;
const base = serverUrl;

// Loaded once per page: the epoch in it is the doc epoch this tab was built against.
let config: Promise<ServerConfig> | null = null;
export function loadConfig(): Promise<ServerConfig> {
  config ??= fetch(`${base()}/api/config`).then((r) => r.json() as Promise<ServerConfig>);
  config.catch(() => { config = null; });   // server not up yet: try again on the next call
  return config;
}

let supabase: SupabaseClient | null = null;
let session: Session | null = null;
let state: AuthState = { ready: false, auth: false, login: null, approved: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<AuthState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

const loginOf = (s: Session | null) => {
  const m = s?.user.user_metadata ?? {};
  return s ? String(m.user_name ?? m.preferred_username ?? s.user.email?.split('@')[0] ?? s.user.id) : null;
};

// Keep the person's GitHub token on the server (memory only) so Approve can push as them.
function sendProviderToken(s: Session | null) {
  if (!s?.provider_token) return;
  fetch(`${base()}/api/github/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}` },
    body: JSON.stringify({ providerToken: s.provider_token }),
  }).catch(() => {});
}

// Asks the server whether this account is approved; while it isn't, asks again every 30 s.
let approvalTimer: ReturnType<typeof setTimeout> | undefined;
async function checkApproval() {
  clearTimeout(approvalTimer);
  if (!session) return set({ approved: null });
  const j = await fetch(`${base()}/api/me`, { headers: authHeaders() })
    .then((r) => r.json() as Promise<{ user?: { approved?: boolean } | null }>)
    .catch(() => null);
  const approved = j?.user ? j.user.approved === true : null;
  set({ approved });
  if (!approved) approvalTimer = setTimeout(() => void checkApproval(), 30_000);
}

let started: Promise<void> | null = null;
export function initAuth(): Promise<void> {
  started ??= (async () => {
    try {
      const c = await loadConfig();
      if (!c.auth || !c.supabaseUrl || !c.supabaseAnonKey) return set({ ready: true, auth: false });
      supabase = createClient(c.supabaseUrl, c.supabaseAnonKey);
      session = (await supabase.auth.getSession()).data.session;
      sendProviderToken(session);
      supabase.auth.onAuthStateChange((event, s) => {
        session = s;
        if (event === 'SIGNED_IN') sendProviderToken(s);
        set({ login: loginOf(s) });
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') void checkApproval();
      });
      set({ ready: true, auth: true, login: loginOf(session) });
      void checkApproval();
    } catch {
      started = null;
      set({ ready: true, auth: false, error: 'Could not reach the Hive server' });
    }
  })();
  return started;
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => { void initAuth(); listeners.add(l); return () => { listeners.delete(l); }; },
    () => state,
    () => state,
  );
}

export const accessToken = () => session?.access_token ?? '';
export const authHeaders = (): Record<string, string> => (session ? { Authorization: `Bearer ${session.access_token}` } : {});

export function signIn() {
  void supabase?.auth.signInWithOAuth({ provider: 'github', options: { scopes: 'repo', redirectTo: window.location.href } });
}
export function signOut() {
  void supabase?.auth.signOut().then(() => window.location.reload());
}
