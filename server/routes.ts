import { Router, type NextFunction, type Request, type Response } from 'express';
import { HttpError, getDoc, tasks } from './doc.ts';
import { models, provider } from './llm.ts';
import { summarize } from './planner.ts';
import { filesDir, getTask, handback, handoff, humanEdit, run, startTask, steer, takeover } from './session.ts';
import { WORKSPACE } from './paths.ts';
import { listFiles, readFile, safePath } from './workspace.ts';

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
  res.json({ ok: true, tasks: tasks().size, provider, models });
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

routes.use((_req, _res) => { throw new HttpError(404, 'Not found'); });

// One error handler: {error} with a status; 500s are logged and never leak details.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const e = err as { status?: number; statusCode?: number; message?: string };
  const status = e.status ?? e.statusCode ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : e.message || 'Request failed' });
}
