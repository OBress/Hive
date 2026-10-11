# AGENTS.md: Hive

Instructions for AI coding agents working in this repo. Read this file first, then `shared/types.ts` (the data contract) and `INTEGRATION.md` (how the web app talks to the server).

## What this is

Hive is **"Google Docs for coding agents"**: a team shares one live task graph, every agent session is visible to everyone, and anyone can **watch** an agent work, **redirect** it mid-run, **take over** a task and **hand it back** (or hand it to a teammate) with full context. It targets YC's Fall 2026 Multiplayer AI request (Track 1B at the c0mpiled hackathon). The demo runs on one laptop; a second laptop joins over the LAN.

The 90-second demo:

1. Ana types a goal in chat, or the seeded graph is loaded; a task graph appears on every screen.
2. Agents start on ready tasks. Everyone sees each agent's steps stream live: its plan, the file it is writing, tests going red then green.
3. Ben types into the Stats agent's session: "count unique visitors, not hits." The agent acknowledges at its next step and changes course.
4. Ana takes over a task, edits a file and hands it back; the agent continues from her edit. She reassigns another task to Ben, who gets an auto-written summary.
5. Cal asks in chat "what happened on stats?" and gets an answer citing the exact steps.
6. Approve: tests pass on main and it is pushed to GitHub, with commits from agents and people.

Optimize for demo reliability and readability over generality.

## Monorepo layout

```
hive/
  package.json            root scripts: `pnpm dev` (server + web), `pnpm reset`, `pnpm test`
  AGENTS.md, INTEGRATION.md
  scripts/reset.mjs       deletes data/doc.bin, workspace, worktrees, sessions
  shared/                 `@hive/shared`: types.ts (the contract), seed.json (URL shortener graph)
  server/                 Node + TS via tsx, Express + Hocuspocus on :4000
    index.ts              HTTP + websocket, doc load/save, seed, startup recovery
    paths.ts              data/ locations
    doc.ts                getDoc/setDoc and typed helpers; serverWrite(fn)
    llm.ts                generate() for openai (Luminal) / anthropic / fake; model selection
    git.ts                git via execFile; withRepoLock()
    workspace.ts          workspace repo, per-task worktrees, safePath, commits, diffs, merge
    runner.ts             runTests() with node --test (tap)
    agent.ts              coding agent prompt, context builder, parseAction
    session.ts            session loop, scheduler, steer, takeover, handback, handoff
    graph.ts              graph op validation, cycles, ready set, layout
    planner.ts            chat (graph edits or cited answers), summarize()
    auth.ts               Supabase token verification, middleware, GitHub tokens in memory
    mongo.ts              optional MongoDB mirror + history reads
    routes.ts             all Express routes
    settings.ts           /api/config, doc epoch, push repo, env status
    smoke.ts              end-to-end demo check with LLM_PROVIDER=fake
    workspace-template/   the project agents build (copied to data/workspace)
  web/                    Next.js client-only SPA on :5173 (owner: Owen)
  data/                   runtime only, gitignored: doc.bin, workspace/, worktrees/, sessions/
```

Target about 1,500 lines for all of `server/`. If a file grows past its job, simplify.

## Commands

```bash
pnpm i                         # install
pnpm dev                       # server on :4000 and web on :5173
pnpm reset                     # wipe data/ state so the next start loads the seed
pnpm test                      # unit tests (vitest in server/)
pnpm --filter server typecheck
pnpm --filter server smoke     # full demo against the fake provider
```

Set `LLM_PROVIDER=fake` in `.env` to run the whole app with scripted agents and no API key.

## Ownership rules (most important)

- **Owen owns `web/`.** Server sessions never edit, format, move or delete anything in `web/`. Report web issues instead.
- The server side owns `server/`. Root files and `shared/` change only when both people agree.
- `shared/types.ts` is the contract. Import types from it; never redefine them.

## Architecture invariants

- **One Y.Doc** named `"hive"` holds all live state, synced by Hocuspocus. Keys: maps `tasks`, `taskState`, `sessions`, `live`; arrays `steps`, `chat`.
- **Browsers write only `tasks`** (create, edit `title`/`spec`/`deps`/`x`/`y`/`editedBy`/`why`, delete). Everything else is server-only; browsers act through REST.
- **The server writes inside `serverWrite(fn)`** (`doc.transact(fn, 'server')`). Observers ignore origin `'server'`. Store plain JSON only (`clean()` strips `undefined`).
- Server code reads the doc only through `server/doc.ts` (the Hocuspocus-managed instance kept loaded by a direct connection). Never construct a separate `Y.Doc`.
- The doc is saved to `data/doc.bin` every 2 s. Agent transcripts live in `data/sessions/<id>.json`, never in the doc.
- Each task works in its own git worktree `data/worktrees/<id>` on branch `task/<id>`; finished tasks merge into `main` of `data/workspace` under a repo lock.
- Every agent write and every human edit is its own commit. Agents commit as "Hive Agent"; people commit under their own name (GitHub noreply email when signed in).
- **Endpoints that start work return 202**; results arrive through the Y.Doc.

## Auth

Supabase is used **only for sign-in** (GitHub OAuth); there are no Supabase tables. When `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set, every non-GET `/api/*` call needs `Authorization: Bearer <access token>` and the server replaces `by`/`from` with the verified GitHub login; the websocket requires the same token. The person's GitHub `provider_token` is kept in server memory only, for pushing on Approve. With Supabase unset, auth is off and `by`/`from` come from the body.

## Endpoints

| Method and path | Body | Does |
|---|---|---|
| GET /api/health | | `{ok, tasks, provider, models}` |
| GET /api/state | | JSON snapshot of the doc |
| POST /api/run | `{by}` | Auto-run: start ready tasks |
| POST /api/tasks/:id/start | `{by}` | Start one task (409 unless deps done) |
| POST /api/sessions/:id/steer | `{from, text}` | Redirect a running agent |
| POST /api/tasks/:id/takeover | `{by}` | Pause the agent; person becomes owner |
| GET /api/tasks/:id/files | | `{files}` |
| GET /api/tasks/:id/file?path= | | `{path, content}` |
| PUT /api/tasks/:id/file | `{path, content, by}` | Human edit, committed as that person |
| POST /api/tasks/:id/handback | `{by, note}` | Agent resumes from the person's edits |
| POST /api/tasks/:id/handoff | `{by, to, note}` | Reassign; returns `{summary}` |
| GET /api/tasks/:id/summary | | `{summary, stepIds}` |
| POST /api/chat | `{from, text}` | Planner reply appended to chat |
| GET /api/history?taskId= | | Steps for a task |
| POST /api/approve | `{by}` | Test main, push to GitHub |
| GET /api/config | | `{auth, supabaseUrl, supabaseAnonKey, epoch, repo}` |
| POST /api/repo | `{repo}` | Set the push target (owner/repo) |
| GET/POST /api/env | `{name, value}` | Which vars are set; write one (server machine only) |
| GET /api/me | | `{user, githubConnected}` |
| POST /api/github/token | `{providerToken}` | Keep GitHub token in memory |

Errors are always `{error: "message"}` with a proper status code. Full examples are in `INTEGRATION.md`.

## Dependencies

`yjs`, `@hocuspocus/server`, `@hocuspocus/provider` (v4), `express` (v5), `@anthropic-ai/sdk`, `@supabase/supabase-js`, `mongodb`, `next` (v16), `react`, `react-dom` (v19), `qrcode`, plus TypeScript tooling and `vitest`. **Nothing else** without a human's OK: use Node built-ins and `fetch`. Call git with `child_process.execFile`, never a shell.

## Secrets

API keys and tokens come from `.env` (or server memory for GitHub provider tokens). Never write them to the Y.Doc, logs, commits, step text or HTTP responses. Agent test runs get a minimal environment with no keys.

## Cross-platform

We develop on Windows and demo on macOS. Use `path.join`, `fs.rmSync(..., {recursive: true, force: true})`, `fs.cpSync`, `execFile`. Never `rm -rf`, `cp` or shell syntax in code or scripts.

## How to work

- Small steps with a visible result; say how to verify each.
- Keep it simple: no abstractions beyond what the demo shows.
- Commit often with a clear message. Don't commit `.env` or `data/`.
- Run `pnpm reset` before a full demo run; run `pnpm --filter server smoke` after server changes.

## Cut order (if behind schedule)

Cut in this order: MongoDB mirror → chat graph edits (keep catch-up answers) → GitHub push (keep the local merge) → hand off to a person (keep takeover and handback). Never cut the live stream, steer, or takeover and handback: they are the pitch.
