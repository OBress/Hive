import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Project, UserSummary, Step, ChatMessage } from '@hive/shared/types';

let db: SupabaseClient | null = null;
export const storageOn = () => db !== null;
const checked = <T>(result: { data: T; error: { message: string } | null }): T => {
  if (result.error) throw new Error(`Supabase storage: ${result.error.message}`);
  return result.data;
};
export async function connectStorage() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) {
    if (url) throw new Error('Supabase storage requires SUPABASE_SERVICE_ROLE_KEY; apply server/supabase.sql first');
    console.log('Storage: files under data/ (Supabase not configured)');
    return;
  }
  if (!url) throw new Error('SUPABASE_URL is required for storage');
  if (!process.env.SUPABASE_ANON_KEY?.trim()) throw new Error('SUPABASE_ANON_KEY is required to enforce sign-in with hosted storage');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  checked(await client.from('hive_records').select('id').limit(1));
  checked(await client.from('hive_projects').select('id').limit(1));
  db = client;
  console.log('Storage: Supabase');
}
async function rows(table: string, kind?: string, project?: string, taskId?: string) {
  const result: { id: string; payload: any }[] = [];
  for (let start = 0; ; start += 500) {
    let query = db!.from(table).select('id,payload').order('id').range(start, start + 499);
    if (kind) query = query.eq('kind', kind);
    if (project) query = query.eq('project', project);
    if (taskId !== undefined) query = query.eq('payload->>taskId', taskId);
    const page = checked(await query) ?? [];
    result.push(...page);
    if (page.length < 500) return result;
  }
}
async function read(kind: string, id: string) {
  return checked(await db!.from('hive_records').select('payload').eq('kind', kind).eq('id', id).maybeSingle())?.payload;
}
async function write(kind: string, id: string, payload: unknown, project: string | null = null) {
  checked(await db!.from('hive_records').upsert({ kind, id, project, payload }, { onConflict: 'kind,id' }));
}
export async function loadProjectsDb(): Promise<Project[]> {
  return (await rows('hive_projects')).map(r => r.payload as Project).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
}
export async function saveProjectDb(p: Project) {
  checked(await db!.from('hive_projects').upsert({ id: p.id, payload: p }));
}
export async function deleteProjectDb(id: string) {
  await flushSessionsDb();
  checked(await db!.from('hive_projects').delete().eq('id', id));
}
export async function loadUsersDb(): Promise<UserSummary[]> { return (await rows('hive_records', 'user')).map(r => r.payload); }
export async function saveUserDb(u: UserSummary) { await write('user', u.login.toLowerCase(), u); }
export async function loadDocDb(id: string): Promise<Uint8Array | null> {
  const payload = await read('doc', id);
  return payload ? Buffer.from(payload.state, 'base64') : null;
}
export async function saveDocDb(id: string, state: Uint8Array) { await write('doc', id, { state: Buffer.from(state).toString('base64') }, id); }
export async function loadSessionsDb(project: string): Promise<{ id: string; data: unknown }[]> {
  return (await rows('hive_records', 'session', project)).map(r => ({ id: r.payload.id, data: r.payload }));
}
const pending = new Set<Promise<unknown>>();
const chains = new Map<string, Promise<unknown>>();
function track(p: Promise<unknown>) {
  pending.add(p);
  void p.finally(() => pending.delete(p)).catch(() => {});
  return p;
}
export function saveSessionDb(project: string, s: { id: string }): Promise<unknown> {
  const id = `${project}/${s.id}`;
  const payload = JSON.parse(JSON.stringify(s));
  const next = (chains.get(id) ?? Promise.resolve()).catch(() => {}).then(() => write('session', id, payload, project));
  chains.set(id, next);
  void next.finally(() => { if (chains.get(id) === next) chains.delete(id); }).catch(() => {});
  return track(next);
}
export async function flushSessionsDb() { await Promise.allSettled([...pending]); }
export async function epochDb(): Promise<string | null> { return (await read('meta', 'epoch'))?.value ?? null; }
export async function setEpochDb(value: string) { await write('meta', 'epoch', { value }); }
export function saveHistoryDb(kind: 'step' | 'chat', project: string, value: Step | ChatMessage) {
  // Event IDs can repeat after restoring an older document checkpoint; keep both history entries.
  return track(write(kind, `${project}/${randomUUID()}`, value, project));
}
export async function historyDb(project: string, taskId: string): Promise<Step[]> {
  return (await rows('hive_records', 'step', project, taskId)).map(r => r.payload as Step).filter(s => s.taskId === taskId).sort((a,b) => a.n-b.n);
}
