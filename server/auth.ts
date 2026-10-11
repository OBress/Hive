import { createClient } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';

export interface HiveUser { id: string; login: string; name: string; avatarUrl: string; githubId: string }
type Verifier = (token: string) => Promise<HiveUser | null>;

let verifier: Verifier | null = null;
const cache = new Map<string, { user: HiveUser | null; at: number }>();
// GitHub provider tokens by Supabase user id: server memory only, never the doc, logs, disk or responses.
export const githubTokens = new Map<string, string>();

export const authEnabled = () => verifier !== null;

// For tests: stub the verifier (null turns auth off).
export function setVerifier(v: Verifier | null) {
  verifier = v;
  cache.clear();
}

export function initAuth() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    console.log('Auth off: SUPABASE_URL / SUPABASE_ANON_KEY not set; names come from request bodies');
    return;
  }
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  setVerifier(async (token) => {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    const m = data.user.user_metadata ?? {};
    const login = String(m.user_name ?? m.preferred_username ?? data.user.email?.split('@')[0] ?? data.user.id);
    return { id: data.user.id, login, name: String(m.full_name ?? m.name ?? login), avatarUrl: String(m.avatar_url ?? ''), githubId: String(m.provider_id ?? m.sub ?? '') };
  });
  console.log('Auth on: Supabase GitHub sign-in required for changes');
}

export async function verifyToken(token: string): Promise<HiveUser | null> {
  if (!verifier || !token) return null;
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.user;
  const user = await verifier(token).catch(() => null);
  cache.set(token, { user, at: Date.now() });
  return user;
}

const bearer = (req: Request) => /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1]?.trim() ?? '';

// With auth on: non-GET calls need a valid token, and the verified login replaces `by` / `from`.
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!authEnabled()) return next();
  const token = bearer(req);
  const user = token ? await verifyToken(token) : null;
  if (user) {
    res.locals.user = user;
    res.locals.githubToken = githubTokens.get(user.id);
  }
  if (req.method === 'GET' || req.method === 'OPTIONS') return next();
  if (!user) return void res.status(401).json({ error: token ? 'Invalid or expired sign-in' : 'Sign in required' });
  req.body = { ...(req.body ?? {}), by: user.login, from: user.login };
  next();
}

// Hocuspocus onAuthenticate: reject unknown users when auth is on; the user rides on the connection context.
export async function wsAuthenticate({ token }: { token: string }) {
  if (!authEnabled()) return {};
  const user = await verifyToken(token);
  if (!user) throw new Error('Sign in required');
  return { user };
}
