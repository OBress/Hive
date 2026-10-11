import { Router, type NextFunction, type Request, type Response } from 'express';
import { addChat, addStep, HttpError, getDoc } from './doc.ts';
import { githubTokens, authEnabled } from './auth.ts';
import { withRepoLock } from './git.ts';
import { createRepo, pushMain, remoteFor } from './github.ts';
import { models, provider } from './llm.ts';
import { history } from './mongo.ts';
import { chat, summarize } from './planner.ts';
import { filesDir, getTask, handback, handoff, humanEdit, run, startTask, steer, takeover } from './session.ts';
import { createProject, current, getProject, inProject, listProjects, openProject, slugOf, updateProject, workspaceDir } from './projects.ts';
import { runTests } from './runner.ts';
import { pushRemote } from './settings.ts';
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

// ---- /api: server-wide routes and the project list ----

export const api = Router();

api.get('/health', (_req, res) => {
  res.json({ ok: true, projects: listProjects().length, provider, models, auth: authEnabled() });
});

api.get('/projects', (_req, res) => {
  res.json({ projects: listProjects() });
});

api.post('/projects', async (req, res) => {
  const { name } = need(req, 'name');
  if (name.length > 60) throw new HttpError(400, 'name must be at most 60 characters');
  const p = createProject(name, opt(req, 'goal').slice(0, 500), opt(req, 'by') || 'Guest');
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
    updateProject(id, { repo });
    console.log(`Project ${id}: created GitHub repo ${repo}`);
    await inProject(id, () => withRepoLock(() => pushMain(workspaceDir(), remoteFor(repo), token)));
    return undefined;
  } catch (e) {
    console.error(`Project ${id}: ${(e as Error).message}`);
    return (e as Error).message;
  }
}

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
