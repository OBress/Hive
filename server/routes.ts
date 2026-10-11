import { Router, type NextFunction, type Request, type Response } from 'express';
import { addChat, addStep, HttpError, getDoc } from './doc.ts';
import { githubTokens, authEnabled } from './auth.ts';
import { git, withRepoLock } from './git.ts';
import { createRepo, repoSlug } from './github.ts';
import { models, provider } from './llm.ts';
import { history } from './mongo.ts';
import { chat, stackDoc, summarize } from './planner.ts';
import { filesDir, getTask, handback, handoff, humanEdit, run, startTask, steer, stopProject, takeover } from './session.ts';
import {
  canSee, createProject, current, deleteProject, getProject, inProject, isOwner, listProjects, openProject, projectsFor, setShared, updateProject, workspaceDir,
} from './projects.ts';
import { runTests } from './runner.ts';
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
  res.json({ projects: projectsFor(me) });
});

api.post('/projects', async (req, res) => {
  const { name } = need(req, 'name');
  if (name.length > 60) throw new HttpError(400, 'name must be at most 60 characters');
  const by = opt(req, 'by') || 'Guest';
  if (!authEnabled()) rememberUser({ login: by, name: by, avatarUrl: '' });
  const goal = opt(req, 'goal').slice(0, 500);
  // Every project gets its own new GitHub repo, made with the creator's OAuth token (GITHUB_TOKEN with auth off).
  // Signed in without a GitHub token on the server, creation is refused; with auth off and no token it is skipped.
  const token: string | undefined = res.locals.githubToken || process.env.GITHUB_TOKEN || undefined;
  if (authEnabled() && !token) throw new HttpError(428, 'Connect GitHub first: Hive creates a repo for every project');
  const repoName = repoSlug(opt(req, 'repoName') || name);
  if (token && !repoName) throw new HttpError(400, 'repoName must contain letters or digits');
  const repo = token ? await createRepo(token, repoName, goal || name, req.body?.private !== false) : null;
  const p = createProject(name, goal, by, opt(req, 'stack').slice(0, MAX_STACK) || undefined, repo);
  await openProject(p);
  console.log(`Project ${p.id} created by ${p.createdBy}`);
  res.status(201).json(p);
});

// Draft a stack / spec doc for a project that doesn't exist yet; the person edits and approves it before creating.
api.post('/stack', async (req, res) => {
  const { name } = need(req, 'name');
  res.json({ stack: await stackDoc(name.slice(0, 60), opt(req, 'goal').slice(0, 500), opt(req, 'notes').slice(0, 1000)) });
});

// People to share with: everyone who has signed in here, matched by login or name.
api.get('/users', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
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
routes.post('/repo', (req, res) => {
  const repo = req.body?.repo;
  if (repo !== null && !(typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo.trim()))) {
    throw new HttpError(400, 'repo must be "owner/repo" or null');
  }
  res.json(updateProject(current().id, { repo: repo?.trim() ?? null }));
});

// Share with / unshare from someone who has signed in here. Anyone on the project may share; the owner can't be removed.
function shareRoute(on: boolean) {
  return (req: Request, res: Response) => {
    const { by, login } = need(req, 'by', 'login');
    const p = current();
    if (!canSee(p, by)) throw new HttpError(403, 'Only people on this project can share it');
    const user = findUser(login);
    if (on && !user) throw new HttpError(404, `No Hive account for "${login}"; they need to sign in once first`);
    if (isOwner(p, login)) throw new HttpError(400, `${p.createdBy} owns this project`);
    res.json(setShared(p.id, user?.login ?? login, on));
  };
}
routes.post('/share', shareRoute(true));

// Rename: anyone on the project. Delete: only its owner; stops its agents and removes its data (not its GitHub repo).
routes.post('/rename', (req, res) => {
  const { by, name } = need(req, 'by', 'name');
  if (name.length > 60) throw new HttpError(400, 'name must be at most 60 characters');
  if (!canSee(current(), by)) throw new HttpError(403, 'Only people on this project can rename it');
  res.json(updateProject(current().id, { name }));
});

routes.post('/delete', async (req, res) => {
  const { by } = need(req, 'by');
  const p = current();
  if (!isOwner(p, by)) throw new HttpError(403, `Only ${p.createdBy} can delete this project`);
  stopProject();
  await deleteProject(p.id);
  console.log(`Project ${p.id} deleted by ${by}`);
  res.json({ ok: true });
});
routes.post('/unshare', shareRoute(false));

routes.get('/state', (_req, res) => {
  const d = getDoc();
  res.json(Object.fromEntries(['tasks', 'taskState', 'sessions', 'live', 'steps', 'chat'].map((k) => [k, d.share.get(k)?.toJSON() ?? null])));
});

routes.post('/run', (req, res) => {
  need(req, 'by');
  res.status(202).json({ started: run() });
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
      const authed = remote.replace(/^https:\/\//, `https://x-access-token:${encodeURIComponent(token)}@`);
      try {
        await git(repo, ['-c', 'credential.helper=', 'push', authed, 'main:main']);
        pushed = true;
      } catch (e) {
        pushError = (e as Error).message.split(authed).join(remote).split(token).join('***').split(encodeURIComponent(token)).join('***');
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
