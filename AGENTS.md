# AGENTS.md: Hive

Instructions for AI coding agents working in this repo. Read this file first, then `SPEC.md` (the full demo build doc) and `shared/types.ts` (the data contract).

## What this is

Hive is a **hackathon demo build**: a 90-second live demo of humans and AI agents co-editing a landing page in one live workspace. It must work **every time on one laptop**. Every agent call is a real LLM call; everything else is the simplest code that makes the five demo stages happen:

1. **Shared collaboration**: live section edits across windows; the Design agent restyles a section; the Engineering agent builds the site section by section.
2. **Human interruption**: a requirement change while a section is generating marks it stale, aborts it and rebuilds only that section.
3. **Agent conflict + resolution**: two Design requests that clash (or break CTA contrast) open a Conflict; an AI-merged option is applied if it passes the rule, otherwise a human picks A or B.
4. **Shared memory**: Ask answers "why" questions from the recorded decision log, citing decision ids.
5. **Deploy**: Publish runs four deterministic checks and writes a static page served at `/site/`.

Optimize for demo reliability and readability over generality. Do not build anything the demo doesn't show.

## Monorepo layout

```
hive/
  package.json         root scripts: `pnpm dev` (server + web), `pnpm reset`
  pnpm-workspace.yaml  workspaces: shared, server, web
  AGENTS.md            this file
  SPEC.md              full demo build doc (source of truth for behavior)
  .env                 ANTHROPIC_API_KEY + model names (never committed; copy .env.example)
  scripts/reset.mjs    deletes data/doc.bin
  shared/              package `@hive/shared` (raw TS, no build step)
    types.ts           the ONLY contract between web/ and server/ (frozen), plus DOC_NAME, MAPS, ports
    seed.json          Nav, Hero (animated gradient), Features, Footer
  server/              Node + TS via tsx, Express + Hocuspocus on :4000   (owner: Person B)
    index.ts           HTTP + websocket, doc load/save, getDoc(), /site static route
    orchestrator.ts    versions, staleness observer, tasks, abort/restart, conflict check
    agents.ts          design(), engineer(), mergeConflict(), ask(); all prompts live here
    checks.ts          contrast() + publish checks
    publish.ts         page template + write to data/published/v<n>/
  web/                 Next.js (App Router) + React + TS on :5173         (owner: Person A)
    lib/hive.ts        HocuspocusProvider singleton + hooks: useYMap, useStatus, useUserName, apiUrl
    app/page.tsx       3 columns: editor | canvas + preview | panels
    components/
      Editor.tsx       section list, field inputs, add section, "why?" popover
      Canvas.tsx       renders sections from fields (design view)
      Preview.tsx      sandboxed iframe srcdoc built from the code map (site view)
      Presence.tsx     avatars for humans and agents
      Panels.tsx       tasks, conflict card, history + Ask, publish + QR
  data/                runtime only, gitignored: doc.bin, published/v<n>/
```

Files not yet created are planned; create them where listed.

Target size is about 2,000 lines total. If a change makes a file much bigger than its job, stop and simplify.

## Commands

```bash
pnpm i          # install
pnpm dev        # server on :4000 and web on :5173
pnpm reset      # delete data/doc.bin so the next start loads shared/seed.json
pnpm test       # unit tests (contrast() and publish checks at minimum)
```

Open `localhost:5173/?name=Maya`, `?name=Sam`, `?name=Priya` in separate browser profiles or incognito windows. The published site is at `localhost:4000/site/` (or the laptop's LAN IP for a phone).

Scripts must be cross-platform (we develop on Windows and demo on macOS): use Node scripts or cross-platform tools in `package.json`, never `rm -rf`, `cp` or shell-specific syntax.

## Ownership rules (most important)

- **Work only in the folder you were assigned.** A Person A session edits only `web/`. A Person B session edits only `server/`. If you weren't told, ask.
- **Never edit `shared/`.** `shared/types.ts` and `shared/seed.json` are frozen after setup. If the contract truly needs to change, stop and tell the human; both people must agree.
- Root files (`package.json`, `.gitignore`, `AGENTS.md`) change only when a human asks.

## Architecture invariants

- **One Y.Doc** named `"hive"` holds all app state, synced by Hocuspocus. Top-level keys: `sections`, `code`, `tasks`, `conflicts` (Y.Maps) and `decisions` (Y.Array). The UI reads everything from the doc; there is no other client state worth syncing.
- **Browsers write only `sections`** (including `requirement` and `lastWhy`). The server writes `code`, `tasks`, `conflicts` and `decisions`. The web app never writes those four.
- **No database.** The server saves the encoded doc to `data/doc.bin` every 2 s and loads it on start; otherwise it seeds from `shared/seed.json`. Server code reads and writes the doc only via `getDoc()` from `server/index.ts` (the Hocuspocus-managed instance, kept loaded by a direct connection); never construct a separate `Y.Doc`.
- **Versioning is one in-memory counter per section** (`versions[sectionId]`), bumped on every human edit. `CodeUnit.builtFromVersion < versions[id]` means stale. Don't add more versioning than that.
- **Agent writes never stale themselves.** Wrap every server write to the doc with the `applyingAgentWrite` flag (or a transaction origin) so the sections observer ignores it.
- **Every Design agent write goes through `applyDesignPatch`**: compare against the task's start snapshot, run the contrast rule, and open a Conflict instead of writing on failure. Agents never silently overwrite.
- **Endpoints start work and return 202**; results arrive through the Y.Doc. Exceptions: `/api/ask` returns `{answer, decisionIds}`, `/api/publish` returns `{url, checks}`.

| Endpoint | Body |
|---|---|
| `POST /api/design` | `{sectionId, instruction, by}` |
| `POST /api/build` | `{by}` |
| `POST /api/conflicts/:id/resolve` | `{choice: 'A' \| 'B' \| 'merged', by}` |
| `POST /api/ask` | `{question}` |
| `POST /api/publish` | `{by}` |

## Dependencies

Pinned list: `yjs`, `@hocuspocus/server`, `@hocuspocus/provider` (both v4), `express` (v5), `@anthropic-ai/sdk`, `next` (v16), `react`, `react-dom` (v19), `qrcode`, plus TypeScript tooling (`typescript`, `tsx`, `@types/*`) and a test runner (`vitest`, server only). **Do not add anything else** without a human's OK. Write the 15 lines yourself instead.

## Hive's own LLM agents (server/agents.ts)

- Only the server holds `ANTHROPIC_API_KEY`, read from `.env`. Never expose it to `web/`, logs, or the doc.
- Model names come from `.env`: fast model while building, stronger model for Engineering in final rehearsals.
- **Design agent** returns strict JSON: a patch object containing only allowed `Section` fields. Validate keys and value types (hex colors, enum `animation`).
- **Engineering agent** returns only an HTML snippet: one root element with `data-section="<id>"`, Tailwind classes, the exact headline text, **no `<script>`**. Strip any script tags and inline handlers regardless. Revise mode gets the old code plus what changed.
- **Ask** gets the whole decision log plus the question and must cite decision ids.
- **Merge** produces one option satisfying both intents with CTA contrast ≥ 3:1.
- Validate every response; **retry once** on bad output, then mark the task `failed`.
- Engineering calls must support `AbortController`: abort on stale, debounce 1.5 s, restart with max 3 restarts, then ask a human.
- Hero generation should take 8 s or more so there's time to interrupt on stage; ask for richer markup in the Hero prompt if it's faster.

## Safety

- The preview iframe uses `sandbox="allow-scripts"` and **never** `allow-same-origin`.
- Agent HTML is script-stripped; the publish template injects only the Tailwind CDN script.
- Contrast rule (WCAG relative luminance): CTA background vs section background ≥ 3:1, CTA text vs CTA background ≥ 4.5:1. `contrast()` must have unit tests.

## Publish checks (server/checks.ts)

All four must pass before writing `data/published/v<n>/index.html`:
1. Every section has code with status `ready` and not stale.
2. Each section's HTML contains its headline text.
3. Sections with `animation: 'none'` contain no `animate-` classes or `@keyframes`.
4. CTA contrast passes the rule above.

## UI conventions (web/)

- Next.js is used as a **client-only SPA**: the Hive UI is `'use client'` components. No API routes, server actions or server components that fetch data; the Node server on :4000 is the only backend. Next 16 has breaking changes, so check `web/node_modules/next/dist/docs/` before relying on remembered APIs (see `web/AGENTS.md`, which `next dev` regenerates).
- Get the doc only through `lib/hive.ts` (`getProvider().document`); never create a second provider. Build server URLs with `apiUrl()` so a LAN IP works.
- Name comes from `?name=`; use it for Hocuspocus awareness and as `by` in every request.
- Statuses (generating / stale / restarting / conflict / done) must be **big and readable from the back of a room**: color plus text, not color alone.
- When a requirement changes, show the "why?" popover and write the answer to the section's `lastWhy`.
- Clicking a cited decision id highlights that decision and its section.

## How to work

- **Small steps with a visible result.** "Make two windows sync the sections map", not "build the editor". After each step, say how to verify it in the browser.
- Keep it simple: no abstractions, state libraries, routers or CSS frameworks in the app beyond what's listed. Plain React state plus the Y.Doc.
- TypeScript everywhere; import types from `shared/types.ts`, never redefine them.
- Commit every 20 to 30 minutes with a clear message so a bad generation is one `git checkout` away. Don't commit `.env` or `data/`.
- Run `pnpm reset` before testing a full demo run.

## Cut order (if behind schedule)

Cut in this order: QR code → merged conflict option (human picks A or B) → LLM in Ask (show matching decisions instead) → Add section menu (Features already in the seed). Nothing new after 4:15.
