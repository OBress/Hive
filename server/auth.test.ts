import { afterEach, expect, test } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { authMiddleware, setVerifier } from './auth.ts';

const ana = { id: 'u1', login: 'ana-gh', name: 'Ana', avatarUrl: '', githubId: '42' };

async function call(method: string, body: Record<string, unknown>, auth?: string) {
  const req = { method, body, headers: auth ? { authorization: auth } : {} } as unknown as Request;
  const out: { status?: number; json?: unknown; next: boolean; locals: Record<string, unknown> } = { next: false, locals: {} };
  const res = {
    locals: out.locals,
    status(code: number) { out.status = code; return this; },
    json(v: unknown) { out.json = v; return this; },
  } as unknown as Response;
  await authMiddleware(req, res, (() => { out.next = true; }) as NextFunction);
  return { ...out, body: req.body };
}

afterEach(() => setVerifier(null));

test('a valid token replaces by/from with the verified login', async () => {
  setVerifier(async (t) => (t === 'good' ? ana : null));
  const r = await call('POST', { by: 'Mallory', text: 'hi' }, 'Bearer good');
  expect(r.next).toBe(true);
  expect(r.body).toMatchObject({ by: 'ana-gh', from: 'ana-gh', text: 'hi' });
  expect(r.locals.user).toEqual(ana);
});

test('a missing or bad token gets 401 when auth is on', async () => {
  setVerifier(async (t) => (t === 'good' ? ana : null));
  const missing = await call('POST', { by: 'Ana' });
  expect(missing.status).toBe(401);
  expect(missing.next).toBe(false);
  expect((await call('PUT', { by: 'Ana' }, 'Bearer bad')).status).toBe(401);
  expect((await call('GET', {})).next).toBe(true);
});

test('with auth off the body name is used', async () => {
  const r = await call('POST', { by: 'Ana' });
  expect(r.next).toBe(true);
  expect(r.body).toEqual({ by: 'Ana' });
});
