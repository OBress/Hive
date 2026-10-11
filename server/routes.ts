import { Router, type NextFunction, type Request, type Response } from 'express';
import { addChat, addStep, HttpError, getDoc, tasks } from './doc.ts';
import { githubTokens, authEnabled } from './auth.ts';
import { git, withRepoLock } from './git.ts';
import { models, provider } from './llm.ts';
import { history } from './mongo.ts';
import { chat, summarize } from './planner.ts';
import { filesDir, getTask, handback, handoff, humanEdit, run, startTask, steer, takeover } from './session.ts';
import { WORKSPACE } from './paths.ts';
import { runTests } from './runner.ts';
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

export const routes = Router();

routes.get('/health', (_req, res) => {
  res.json({ ok: true, tasks: tasks().size, provider, models, auth: authEnabled() });
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
  res.json({ files: listFiles(filesDir(id(req)) ?? WORKSPACE) });
});

routes.get('/tasks/:id/file', (req, res) => {
  const p = safePath(req.query.path);
  if (!p) throw new HttpError(400, 'path must be a file under src/ or test/');
  const content = readFile(filesDir(id(req)) ?? WORKSPACE, p);
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

// Test main; if green, push it to GitHub with the approver's token (else GITHUB_TOKEN, else not at all).
routes.post('/approve', async (req, res) => {
  const { by } = need(req, 'by');
  const token: string | undefined = res.locals.githubToken || process.env.GITHUB_TOKEN || undefined;
  const remote = process.env.GITHUB_REMOTE?.trim() ?? '';
  const result = await withRepoLock(async () => {
    const r = await runTests(WORKSPACE);
    if (r.failed > 0 || r.passed === 0) {
      addStep({ kind: 'error', by, text: `Approve blocked: ${r.passed} passed, ${r.failed} failed on main` });
      return { status: 409, body: { ok: false, error: 'Tests failed on main', output: r.output } };
    }
    const commit = await head(WORKSPACE);
    let pushed = false;
    let pushError: string | undefined;
    if (remote && token) {
      const authed = remote.replace(/^https:\/\//, `https://x-access-token:${encodeURIComponent(token)}@`);
      try {
        await git(WORKSPACE, ['-c', 'credential.helper=', 'push', authed, 'main:main']);
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

routes.get('/me', (_req, res) => {
  const user = res.locals.user ?? null;
  res.json({ user, githubConnected: !!user && githubTokens.has(user.id) });
});

routes.post('/github/token', (req, res) => {
  const { providerToken } = need(req, 'providerToken');
  const user = res.locals.user;
  if (!user) throw new HttpError(400, 'Sign-in is off on this server; set GITHUB_TOKEN in .env to push');
  githubTokens.set(user.id, providerToken);
  res.json({ ok: true });
});

routes.use((_req, _res) => { throw new HttpError(404, 'Not found'); });

// One error handler: {error} with a status; 500s are logged and never leak details.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const e = err as { status?: number; statusCode?: number; message?: string };
  const status = e.status ?? e.statusCode ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : e.message || 'Request failed' });
}
