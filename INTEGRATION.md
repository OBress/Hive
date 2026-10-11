# INTEGRATION.md: connecting web/ to server/

How the frontend talks to the Hive server. Types are in `shared/types.ts`; import them from `@hive/shared/types`.

## The Y.Doc

One Y.Doc named `hive` (`DOC_NAME`), synced by Hocuspocus at `ws://<host>:4000`. Load all state from it and re-render on changes.

| Key | Type | Written by | Holds |
|---|---|---|---|
| `tasks` (map) | `TaskSpec` by id | **browsers** and the server's Planner | the graph: title, spec, deps, x/y |
| `taskState` (map) | `TaskState` by task id | server only | status, owner, sessionId, lastTest, note |
| `sessions` (map) | `SessionView` by session id | server only | state, summary, stepCount |
| `live` (map) | `string` by session id | server only | the text the agent is typing right now (updates every 150 ms, deleted when the call ends) |
| `steps` (array) | `Step` | server only, append-only | the feed: plans, reads, edits (with diff), tests, steers, takeovers, merges... |
| `chat` (array) | `ChatMessage` | server only | team chat and Planner replies (with `cites` step ids) |

Browsers write **only `tasks`**: create a task, edit `title`, `spec`, `deps`, `x`, `y`, delete it. When editing a spec, also set `editedBy` (your name) and `why` (the reason) in the same transaction; the server records a `spec-change` step and forwards the change to a running agent. A new task gets a `taskState` (`todo`, owner agent) from the server automatically.

Useful derived views:
- Steps for a task: `steps.filter(s => s.taskId === id)`; for a session: `s.sessionId === sid`.
- A task's live session: `taskState[id].sessionId`, then `sessions[sid]` and `live[sid]`.
- A task is ready when its status is `todo`, its owner is the agent, and all deps are `done`.

## REST

Base URL `http://<host>:4000`. JSON bodies. Endpoints that start work return **202** and the result arrives through the doc. Errors are always:

```json
{ "error": "Task not found" }
```

with 400 (bad body), 401 (no/invalid token when auth is on), 403 (not allowed), 404 (unknown task/session), 409 (wrong state), 500.

When auth is on (see below), `by`/`from` in bodies are ignored and replaced by the signed-in GitHub login. When it's off, send them.

| Method and path | Body | Response |
|---|---|---|
| GET /api/health | | `{ok: true, tasks: 4, provider: "fake", models: {agent, planner}, auth: false}` |
| GET /api/state | | `{tasks, taskState, sessions, live, steps, chat}` (whole doc as JSON) |
| POST /api/run | `{by}` | 202 `{started: ["store"]}`: auto-run on, starts ready tasks now and later |
| POST /api/tasks/:id/start | `{by}` | 202 `{sessionId}`; 409 if deps aren't done or it's already running |
| POST /api/sessions/:id/steer | `{from, text}` | 202 `{ok: true}`; the agent acknowledges ("Got it: ...") at its next step |
| POST /api/tasks/:id/takeover | `{by}` | 200 `{sessionId}`; agent paused, owner `{kind:'human', name: by}` |
| GET /api/tasks/:id/files | | `{files: ["src/store.js", "test/store.test.js", ...]}` |
| GET /api/tasks/:id/file?path=src/store.js | | `{path, content}` |
| PUT /api/tasks/:id/file | `{path, content, by}` | `{commit}`; only the current human owner; paths under `src/` or `test/` |
| POST /api/tasks/:id/handback | `{by, note}` | 202 `{ok: true}`; agent resumes with the diff of the person's edits |
| POST /api/tasks/:id/handoff | `{by, to, note}` | `{summary}`; `to` is a person's name or `"agent"` |
| GET /api/tasks/:id/summary | | `{summary, stepIds}` (regenerated) |
| POST /api/chat | `{from, text}` | 202 `{id}`; Planner reply appears in `chat` (may also edit `tasks`) |
| GET /api/history?taskId=stats | | `{steps: Step[], source: "mongo" \| "doc"}` |
| POST /api/approve | `{by}` | `{ok: true, commit, pushed, url, pushError?}`; 409 `{ok: false, error, output}` if tests fail on main |
| GET /api/config | | `{auth, supabaseUrl?, supabaseAnonKey?, epoch, repo}`: what the browser needs before connecting (the anon key is public) |
| POST /api/repo | `{repo: "owner/repo" \| null}` | Sets the push target for Approve (overrides `GITHUB_REMOTE`) |
| GET /api/env | | `{NAME: {set: boolean}}` for every server variable; never values |
| POST /api/env | `{name, value}` | Writes one variable to `.env`; **only from the machine running the server** (403 otherwise); `{ok, restartNeeded}` |
| GET /api/me | | `{user: HiveUser \| null, githubConnected}` (`user` is null when auth is off) |
| POST /api/github/token | `{providerToken}` | `{ok: true}`; kept in server memory only (400 when auth is off) |

Examples:

```http
POST /api/sessions/s_stats_1/steer
{"from": "Ben", "text": "count unique visitors, not hits"}
→ 202 {"ok": true}

POST /api/tasks/redirect/handoff
{"by": "Ana", "to": "Ben", "note": "can you finish the edge cases?"}
→ 200 {"summary": "Done: ...\nLeft: ...\nTried and failed: ...\nOpen questions: ..."}

POST /api/chat
{"from": "Cal", "text": "what happened on stats?"}
→ 202 {"id": "c_..."}   then chat gets {from: "planner", text, cites: ["st_12", "st_15"]}
```

## Auth (Supabase GitHub OAuth)

Supabase is used only for sign-in. It is **on** when the server's `.env` has `SUPABASE_URL` and `SUPABASE_ANON_KEY`, and off otherwise (local dev, fake mode; names then come from `?name=`). The web app needs no env file: it reads the Supabase URL and anon key from `GET /api/config`. This is all wired in `web/lib/auth.ts`:

1. `AuthGate` (in the root layout) shows "Sign in with GitHub" until there is a session: `signInWithOAuth({provider: 'github', options: {scopes: 'repo', redirectTo: location.href}})`.
2. Every REST call sends `Authorization: Bearer <access_token>` (`authHeaders()`); the server replaces `by`/`from` with the GitHub login.
3. The websocket token is JSON `{epoch, access}` (see below); the server rejects unknown users.
4. After sign-in, `provider_token` is posted once to `/api/github/token`, so Approve pushes as that person.
5. `useUserName()` returns the GitHub login when auth is on.

Supabase setup: Authentication → Providers → GitHub on (client id/secret from a GitHub OAuth App whose callback is `https://<project>.supabase.co/auth/v1/callback`), and Authentication → URL Configuration → add `http://localhost:5173/**` and `http://<lan-ip>:5173/**` as redirect URLs.

## Doc epoch (resets)

Each fresh seed (first run or `pnpm reset`) gets a new epoch. A tab sends the epoch it loaded with in its websocket token; a tab from before the reset is refused with reason `stale-epoch` and reloads itself, instead of syncing its old doc into the fresh server.

## How the frontend should use this

- `web/lib/mock.ts` is the live adapter: it maps the doc and REST onto the shapes the components use (`Task`, `TaskRun`, `Decision`...). Acceptance checks are stored inside `spec` under an "Acceptance checks:" heading so the agent reads them; `files` come from the task's commits; decisions are steps (ids `st_<n>`, so planner cites line up).

- To build the UI with no API key, run the server with `LLM_PROVIDER=fake` in `.env`: scripted agents stream, test, merge and answer chat.
- Ids: steps are `st_<n>` (`n` is the global order), sessions `s_<taskId>_<suffix>`, chat `c_...`.

- Read everything from the doc (`useYMap('tasks')`, `taskState`, `sessions`, `live`, and the `steps`/`chat` arrays). There is no other state to fetch.
- Write only `tasks` (graph editing, positions, spec edits with `editedBy` + `why`).
- Call REST for every action: run, start, steer, takeover, file edits, handback, handoff, chat, approve.
- Show `live[sessionId]` as the agent's streaming text and `steps` as the feed; `Step.diff` is a unified diff, `Step.test` has pass/fail counts.
- Send the Supabase token on every call and on the websocket when auth is on.
