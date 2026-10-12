import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { ARRAYS, MAPS } from '@hive/shared/types';
import { addChat, addStep, HttpError, getDoc } from './doc.ts';
import { githubTokens, githubTokensByLogin, authEnabled, supabasePeople } from './auth.ts';
import { withRepoLock } from './git.ts';
import { createRepo, pushMain, remoteFor } from './github.ts';
import { models, provider } from './llm.ts';
import { history } from './history.ts';
import { chat, setMode, stackDoc, summarize } from './planner.ts';
import { livePreview, stopPreviews } from './preview.ts';
import { filesDir, getTask, handback, handoff, humanEdit, run, startCli, startTask, steer, stopProject, takeover } from './session.ts';
import {
  canSee, createProject, current, deleteProject, projectDir, getProject, inProject, isOwner, listProjects, openProject, projectsFor, setShared, slugOf,
  updateProject, workspaceDir,
} from './projects.ts';
import { runTests, splitArgs } from './runner.ts';
import { pushRemote } from './settings.ts';
import { findUser, rememberUser, searchUsers } from './users.ts';
import { head, listFiles, readFile, safePath } from './workspace.ts';

// Required string fields from the body (400 if missing).
function need(req: Request, ...fields: string[]): Record<string, string> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = body[f];
    if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `Missing "${f}"`);
    out[f] = v.trim();
  }
  return out;
}
const opt = (req: Request, f: string) => (typeof req.body?.[f] === 'string' ? (req.body[f] as string).trim() : '');
const id = (req: Request) => String(req.params.id);
// The person asking: the verified login with auth on, else ?name= (GETs) or the body's `by`.
const who = (req: Request, res: Response): string =>
  res.locals.user?.login || (typeof req.query.name === 'string' && req.query.name.trim()) || opt(req, 'by') || 'Guest';
const MAX_STACK = 20000;

// ---- /api: server-wide routes and the project list ----

export const api = Router();

api.get('/health', (_req, res) => {
  res.json({ ok: true, projects: listProjects().length, provider, models, auth: authEnabled() });
});

// Only the projects this person created or that were shared with them.
api.get('/projects', (req, res) => {
  const me = who(req, res);
  if (!authEnabled()) rememberUser({ login: me, name: me, avatarUrl: '' });
  if (res.locals.user && !res.locals.user.approved) return void res.json({ projects: [] });
  res.json({ projects: projectsFor(me) });
});

api.post('/projects', async (req, res) => {
  const { name } = need(req, 'name');
  if (name.length > 60) throw new HttpError(400, 'name must be at most 60 characters');
  const by = opt(req, 'by') || 'Guest';
  if (!authEnabled()) rememberUser({ login: by, name: by, avatarUrl: '' });
  const p = await createProject(name, opt(req, 'goal').slice(0, 500), by, opt(req, 'stack').slice(0, MAX_STACK) || undefined);
  await openProject(p);
  console.log(`Project ${p.id} created by ${p.createdBy}`);
  const repoError = req.body?.createRepo === false ? undefined : await giveRepo(p.id, res.locals.githubToken || process.env.GITHUB_TOKEN);
  res.status(201).json({ ...getProject(p.id), repoError });
});

// Every new project gets its own private GitHub repo (under the creator's account), set as its push target and
// seeded with the starting files. Failing here never fails the project; the reason goes back as repoError.
async function giveRepo(id: string, token: string | undefined): Promise<string | undefined> {
  if (!token) return 'No GitHub repo was created: sign in with GitHub (or set GITHUB_TOKEN). You can connect one on Overview.';
  const p = getProject(id)!;
  try {
    const repo = await createRepo(token, slugOf(p.name), p.id, p.goal || `${p.name}, built with Hive`);
    await updateProject(id, { repo });
    console.log(`Project ${id}: created GitHub repo ${repo}`);
    await inProject(id, () => withRepoLock(() => pushMain(workspaceDir(), remoteFor(repo), token)));
    return undefined;
  } catch (e) {
    console.error(`Project ${id}: ${(e as Error).message}`);
    return (e as Error).message;
  }
}

// Draft a stack / spec doc for a project that doesn't exist yet; the person edits and approves it before creating.
api.post('/stack', async (req, res) => {
  const { name } = need(req, 'name');
  res.json({ stack: await stackDoc(name.slice(0, 60), opt(req, 'goal').slice(0, 500), opt(req, 'notes').slice(0, 1000)) });
});

// People to share with: everyone who has signed in here, matched by login or name. With auth on, accounts
// from Supabase are added too (someone who signed in but hasn't been approved or used Hive yet), so they can be shared with.
api.get('/users', async (req, res) => {
  const q = (typeof req.query.q === 'string' ? req.query.q : '').trim().slice(0, 60);
  if (res.locals.user?.approved) for (const u of await supabasePeople(res.locals.token, q)) rememberUser(u);
  res.json({ users: searchUsers(q, who(req, res)) });
});

api.get('/me', (_req, res) => {
  const user = res.locals.user ?? null;
  res.json({ user, githubConnected: !!user && githubTokens.has(user.id) });
});

api.post('/github/token', (req, res) => {
  const { providerToken } = need(req, 'providerToken');
  const user = res.locals.user;
  if (!user) throw new HttpError(400, 'Sign-in is off on this server; set GITHUB_TOKEN in .env to push');
  githubTokens.set(user.id, providerToken);
  githubTokensByLogin.set(user.login.toLowerCase(), providerToken);
  res.json({ ok: true });
});

// Everything below runs inside one project: /api/projects/:project/...
export const routes = Router();
api.use('/projects/:project', (req, _res, next) => {
  const p = getProject(String(req.params.project));
  if (!p) throw new HttpError(404, `Project "${req.params.project}" not found`);
  inProject(p.id, next);
}, routes);
api.use((_req, _res) => { throw new HttpError(404, 'Not found'); });

routes.get('/', (_req, res) => {
  res.json(current());
});

// Push target for Approve: owner/repo, or null to disconnect.
routes.post('/repo', async (req, res) => {
  const repo = req.body?.repo;
  if (repo !== null && !(typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo.trim()))) {
    throw new HttpError(400, 'repo must be "owner/repo" or null');
  }
  res.json(await updateProject(current().id, { repo: repo?.trim() ?? null }));
});

// Share with / unshare from someone who has signed in here. Anyone on the project may share; the owner can't be removed.
function shareRoute(on: boolean) {
  return async (req: Request, res: Response) => {
    const { by, login } = need(req, 'by', 'login');
    const p = current();
    if (!canSee(p, by)) throw new HttpError(403, 'Only people on this project can share it');
    const user = findUser(login);
    if (on && !user) throw new HttpError(404, `No Hive account for "${login}"; they need to sign in once first`);
    if (isOwner(p, login)) throw new HttpError(400, `${p.createdBy} owns this project`);
    res.json(await setShared(p.id, user?.login ?? login, on));
  };
}
routes.post('/share', shareRoute(true));
routes.post('/unshare', shareRoute(false));

// Rename: anyone on the project. Delete: only its owner; stops its agents and removes its data (not its GitHub repo).
routes.post('/rename', async (req, res) => {
  const { by, name } = need(req, 'by', 'name');
  if (name.length > 60) throw new HttpError(400, 'name must be at most 60 characters');
  if (!canSee(current(), by)) throw new HttpError(403, 'Only people on this project can rename it');
  res.json(await updateProject(current().id, { name }));
});

routes.post('/delete', async (req, res) => {
  const { by } = need(req, 'by');
  const p = current();
  if (!isOwner(p, by)) throw new HttpError(403, `Only ${p.createdBy} can delete this project`);
  stopProject();
  stopPreviews(projectDir());
  await deleteProject(p.id);
  console.log(`Project ${p.id} deleted by ${by}`);
  res.json({ ok: true });
});

// Read each part through getMap/getArray: after a load from storage, `doc.share` only lists the parts touched so far.
routes.get('/state', (_req, res) => {
  const d = getDoc();
  res.json({
    ...Object.fromEntries(Object.values(MAPS).map((k) => [k, d.getMap(k).toJSON()])),
    ...Object.fromEntries(Object.values(ARRAYS).map((k) => [k, d.getArray(k).toJSON()])),
  });
});

routes.post('/run', (req, res) => {
  const { by } = need(req, 'by');
  res.status(202).json({ started: run(by) });
});

// Manual / Semi-auto / Automatic (see AutonomyMode in shared/types.ts). Anyone on the project may change it.
routes.post('/mode', async (req, res) => {
  const { by, mode } = need(req, 'by', 'mode');
  if (mode !== 'manual' && mode !== 'semi' && mode !== 'auto') throw new HttpError(400, 'mode must be "manual", "semi" or "auto"');
  if (authEnabled() && !canSee(current(), by)) throw new HttpError(403, 'Only people on this project can change its mode');
  await setMode(mode, by);
  res.json(current());
});

// Goal-check screenshots (Step.image is "previews/<file>").
routes.get('/previews/:file', (req, res) => {
  const file = String(req.params.file);
  if (!/^[\w.-]+\.png$/.test(file)) throw new HttpError(400, 'Bad file name');
  const path = join(projectDir(), 'previews', file);
  if (!existsSync(path)) throw new HttpError(404, 'No such screenshot');
  res.sendFile(path);
});

// Live preview (see Preview in shared/types.ts): main's, or a task's folder (main's until it has one).
// Static pages are served from src/ with a sandbox CSP, so their scripts never run as Hive's own origin.
const apiBase = (req: Request) =>
  `${req.get('x-forwarded-proto')?.split(',')[0] || req.protocol}://${req.get('host')}${req.baseUrl}`;
routes.get('/preview', async (req, res) => {
  res.json(await livePreview(workspaceDir(), `${apiBase(req)}/preview/files`, req.hostname));
});
routes.get('/tasks/:id/preview', async (req, res) => {
  getTask(id(req));
  res.json(await livePreview(filesDir(id(req)) ?? workspaceDir(), `${apiBase(req)}/tasks/${encodeURIComponent(id(req))}/preview/files`, req.hostname));
});
function sendPreviewFile(dir: string, req: Request, res: Response) {
  const p = safePath(`src/${([] as string[]).concat(req.params.path ?? []).join('/')}`);
  if (!p || !existsSync(join(dir, p))) throw new HttpError(404, 'No such file');
  res.set({ 'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-modals', 'Cache-Control': 'no-store' });
  res.sendFile(join(dir, p));
}
routes.get('/preview/files/*path', (req, res) => sendPreviewFile(workspaceDir(), req, res));
routes.get('/tasks/:id/preview/files/*path', (req, res) => sendPreviewFile(filesDir(id(req)) ?? workspaceDir(), req, res));

// Run the project's CLI in a task's folder; output streams to terminal[taskId] and a run step.
routes.post('/tasks/:id/cli', (req, res) => {
  const { by } = need(req, 'by');
  startCli(id(req), by, splitArgs(opt(req, 'args')));
  res.status(202).json({ ok: true });
});

routes.post('/tasks/:id/start', async (req, res) => {
  const { by } = need(req, 'by');
  res.status(202).json({ sessionId: await startTask(id(req), by) });
});

routes.post('/sessions/:id/steer', (req, res) => {
  const { from, text } = need(req, 'from', 'text');
  steer(id(req), from, text);
  res.status(202).json({ ok: true });
});

routes.post('/tasks/:id/takeover', async (req, res) => {
  const { by } = need(req, 'by');
  res.json({ sessionId: await takeover(id(req), by) });
});

routes.get('/tasks/:id/files', (req, res) => {
  res.json({ files: listFiles(filesDir(id(req)) ?? workspaceDir()) });
});

routes.get('/tasks/:id/file', (req, res) => {
  const p = safePath(req.query.path);
  if (!p) throw new HttpError(400, 'path must be a file under src/ or test/');
  const content = readFile(filesDir(id(req)) ?? workspaceDir(), p);
  if (content === null) throw new HttpError(404, `${p} not found`);
  res.json({ path: p, content });
});

routes.put('/tasks/:id/file', async (req, res) => {
  const { path, by } = need(req, 'path', 'by');
  if (typeof req.body.content !== 'string') throw new HttpError(400, 'Missing "content"');
  res.json(await humanEdit(id(req), path, req.body.content, by, res.locals.user));
});

routes.post('/tasks/:id/handback', async (req, res) => {
  const { by } = need(req, 'by');
  await handback(id(req), by, opt(req, 'note'));
  res.status(202).json({ ok: true });
});

routes.post('/tasks/:id/handoff', async (req, res) => {
  const { by, to } = need(req, 'by', 'to');
  res.json(await handoff(id(req), by, to, opt(req, 'note')));
});

routes.get('/tasks/:id/summary', async (req, res) => {
  getTask(id(req));
  res.json(await summarize(id(req)));
});

routes.post('/chat', (req, res) => {
  const { from, text } = need(req, 'from', 'text');
  const msg = addChat({ from, text });
  void chat(from, text);
  res.status(202).json({ id: msg.id });
});

// Test main; if green, push it to the repo set on Overview (else GITHUB_REMOTE) with the approver's token
// (else GITHUB_TOKEN, else not at all).
routes.post('/approve', async (req, res) => {
  const { by } = need(req, 'by');
  const token: string | undefined = res.locals.githubToken || process.env.GITHUB_TOKEN || undefined;
  const remote = pushRemote();
  const repo = workspaceDir();
  const result = await withRepoLock(async () => {
    const r = await runTests(repo);
    if (r.failed > 0 || r.passed === 0) {
      addStep({ kind: 'error', by, text: `Approve blocked: ${r.passed} passed, ${r.failed} failed on main` });
      return { status: 409, body: { ok: false, error: 'Tests failed on main', output: r.output } };
    }
    const commit = await head(repo);
    let pushed = false;
    let pushError: string | undefined;
    if (remote && token) {
      try {
        await pushMain(repo, remote, token);
        pushed = true;
      } catch (e) {
        pushError = (e as Error).message;
        addStep({ kind: 'error', by, text: `Push failed: ${pushError.slice(0, 300)}`, commit });
      }
    }
    const url = remote ? remote.replace(/\.git$/, '') : '';
    addStep({ kind: 'approve', by, text: `${by} approved main (${r.passed} tests passed)${pushed ? ' and pushed to GitHub' : ''}`, commit });
    return { status: 200, body: { ok: true, commit, pushed, url, pushError } };
  });
  res.status(result.status).json(result.body);
});

routes.get('/history', async (req, res) => {
  const taskId = typeof req.query.taskId === 'string' ? req.query.taskId : '';
  if (!taskId) throw new HttpError(400, 'Missing "taskId"');
  getTask(taskId);
  res.json(await history(taskId));
});

routes.use((_req, _res) => { throw new HttpError(404, 'Not found'); });

// One error handler: {error} with a status; 500s are logged and never leak details.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const e = err as { status?: number; statusCode?: number; message?: string };
  const status = e.status ?? e.statusCode ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : e.message || 'Request failed' });
}
