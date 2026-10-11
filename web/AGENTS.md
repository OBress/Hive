<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Hive web/: frontend agent guide

Instructions for coding agents working in `web/` (Person A). Read the root `SPEC.md` for behavior and `shared/types.ts` for the data contract. This file covers what the page does, how it's built and how it looks. **Edit only `web/`.** Never edit `shared/` or `server/`.

> **Contract note.** The task-graph spec (tasks, runs, chat, conflicts, decisions) replaces the landing-page contract. Until both people update `shared/types.ts`, the types in `SPEC.md` are the target. Once they land, import them from `@hive/shared/types` and never redefine them locally.

## What the page is

One screen in three parts, live for everyone through the Y.Doc `"hive"`:

```
┌────────────────────────────────────────────────────────────────────────┐
│ TopBar: logo · presence avatars · ShipBar (Run ready · Approve & push) │
├──────────────────────────────────────┬─────────────────┬───────────────┤
│ Graph (React Flow)                   │ TaskPanel       │ Chat          │
│ task nodes + dependency edges        │ opens on node   │ shared thread │
│ ConflictCard floats over the graph   │ click           │               │
└──────────────────────────────────────┴─────────────────┴───────────────┘
```

| Part | Shows | Web writes |
|---|---|---|
| Graph | One node per task, edges from `dependsOn`, colored by run status | `x`, `y` on drag; `dependsOn` on connect or edge delete |
| TaskPanel | Title, spec, acceptance list, files, assignee, `lastWhy`; run status, note, branch, commit, diff, test output | `title`, `spec`, `acceptance`, `files`, `assignee`, `lastWhy` |
| Chat | The shared thread; Planner replies show the `ops` they made and their `cites` as links | Nothing in the doc: messages go through `POST /api/chat` |
| ConflictCard | Both hunks side by side, the proposal, and either "tests pass, applied" or three buttons | Nothing: `POST /api/conflicts/:id/resolve` |
| ShipBar | Run ready tasks, Approve and push, a link to the GitHub commit | Nothing: `POST /api/run`, `POST /api/push` |
| Presence | Avatars for every human (and which node each has open), plus Planner and Builder while busy | Hocuspocus awareness only |

### Data ownership (do not break)

- **The browser writes only the `tasks` Y.Map.** The server writes `runs`, `conflicts`, `chat` and `decisions`; the web app only reads them.
- Direct graph edits are plain Yjs edits with no endpoint. Everything else is a `POST` that returns 202, and the result shows up in the doc.
- Spec edits: keep a local draft while the person types. On **Save** (or blur), show the "why?" prompt, then write `spec`, `acceptance` and `lastWhy` in **one** `doc.transact()`. That way the server's staleness observer gets the reason together with the change. (Agree this with Person B.)
- Wrap every multi-field write in `doc.transact()`.

| Endpoint | Body | Returns |
|---|---|---|
| `POST /api/chat` | `{text, by}` | 202 |
| `POST /api/run` | `{taskId?}` | 202 |
| `POST /api/conflicts/:id/resolve` | `{choice: 'ours' \| 'theirs' \| 'proposal', by}` | 202 |
| `POST /api/push` | `{by}` | `{url}` |

`by` is always the `?name=` value. Build URLs with `apiUrl()`.

## Stack and constraints

- **Next.js 16 (App Router), used as a client-only SPA** on :5173. It's already scaffolded; where the spec says "Vite", read this. Every component is `'use client'`. No API routes, server actions or data-fetching server components. Check `node_modules/next/dist/docs/` before relying on a Next API from memory.
- Libraries: `react`, `react-dom`, `yjs`, `@hocuspocus/provider`, `@xyflow/react` (React Flow v12) and `qrcode`. **Nothing else** without a human's OK: no Tailwind, animation library, state library or icon pack. Write the 15 lines yourself.
- Fonts come from `next/font/google`, which is built in, so it isn't a new dependency: **Rubik** 500/700/800 for display and UI text, **Space Mono** 400/700 for labels, ids, hashes and diffs.
- Styling: plain CSS in `app/globals.css` using the tokens below, plus small `style={{}}` props for per-instance values such as tilt and color. Prefix classes with `hv-`.
- One provider per tab: get the doc only through `getProvider().document` from `lib/hive.ts`.

## File layout

```
web/
  app/
    layout.tsx        fonts, <body>
    page.tsx          the 3-column App; the selected task id lives in React state
    globals.css       tokens, .hv-* components, keyframes
  lib/
    hive.ts           provider singleton, apiUrl, useUserName, useStatus, useYMap,
                      + useYArray, useAwareness, post(path, body), updateTask
  components/
    TopBar.tsx        logo, Presence, ShipBar
    Presence.tsx      avatar stack (humans from awareness, agents from runs)
    ShipBar.tsx       Run ready, Approve and push, commit link (+ QR if time)
    Graph.tsx         ReactFlow canvas: nodes from tasks, edges from dependsOn
    TaskNode.tsx      custom node: title, status sticker, assignee, commit hash
    TaskPanel.tsx     spec editor, acceptance list, files, assignee,
                      run status, diff, test output
    WhyPrompt.tsx     small popover: "Why the change?" -> lastWhy
    Chat.tsx          thread, composer, op chips, cite links
    ConflictCard.tsx  hunks side by side, proposal, result, buttons
    Status.tsx        StatusSticker + the status -> color/label map (single source)
```

Aim for about 1,000 lines across all of `web/`. If a component grows past about 200 lines, split it or simplify it.

## Hooks to add to `lib/hive.ts`

- `useYArray<T>(key)`: like `useYMap`, but returns `T[]` and re-renders on `observeDeep`.
- `useAwareness()`: sets the local state `{name, color, openTaskId}` and returns every peer's state. The color is a stable hash of the name into the palette.
- `post(path, body)`: `fetch(apiUrl(path), {method: 'POST', headers, body: JSON.stringify(body)})`. Returns the parsed JSON, or `null` on 202. Show failures as a toast; never throw into React.
- `updateTask(id, fields)`: reads the task, merges the fields and writes them inside `doc.transact()`.

## Components: behavior and "done when"

**Graph.tsx.** `<ReactFlow>` with `nodeTypes={{task: TaskNode}}` and `import '@xyflow/react/dist/style.css'`.
- Nodes: one per task at `{x, y}`. Edges: for each entry `d` in `t.dependsOn`, an edge `d → t.id`, so a dependency points at the task that depends on it.
- Dragging writes `x`/`y` on `onNodesChange` position events, so other windows see the node move live.
- `onConnect(source → target)`: add `source` to `target.dependsOn`, unless that creates a cycle. Check with a tiny client-side DFS; if it's rejected, shake the node and show a toast. Deleting an edge removes it from `dependsOn`.
- Clicking a node selects it (opening TaskPanel) and sets `openTaskId` in awareness.
- Edges into a `running` node are animated (`animated: true`); no others are.
- Background: `<Background variant="dots" gap={28} />` in ink at low opacity, like the BloxClips dot field.
- New nodes pop in (`hv-pop-in`) when the Planner adds them.
- *Done when* two windows drag the same node live, and a chat request makes five nodes appear in both.

**TaskNode.tsx.** A chunky card about 220 px wide. It shows the title (Rubik 700), a status sticker (see Status), an assignee chip (the person's avatar, or a robot chip for "agent") and, once done, the short commit hash in Space Mono. Small avatars sit along the top edge for every peer whose `openTaskId` is this task. React Flow handles go at the top and bottom, styled as ink circles.

**TaskPanel.tsx.** Slides in from the right of the graph (`hv-slide-in`) when a node is selected; Esc or × closes it.
- Editable fields: title, spec (textarea), acceptance (a list of inputs with add and remove), files (comma-separated) and assignee (a select of `agent` plus the names seen in awareness).
- Spec and acceptance edits follow the draft → Save → WhyPrompt → one-transaction flow. Show `lastWhy` under the spec as a quote sticker.
- Read-only run block: a big status sticker, then `note`, `branch` and `commit`, then the **diff** (Space Mono, `+` lines tinted green, `-` lines tinted red) and the **test output** (cream text in an ink box). Both start collapsed while empty.
- A "Run this task" button sends `POST /api/run {taskId}`.
- *Done when* Ben edits a spec and types why, and Ana's window shows the new spec and the quote.

**Chat.tsx.** Reads `chat` (a Y.Array).
- Bubbles: human messages are paper cards with the person's avatar color on the left border; `planner` and `builder` messages are ink cards with a robot badge.
- Planner messages list their `ops` as small chips ("+ Stats", "Stats → README"). Clicking a chip focuses that node.
- `cites` render as mono links like `#d12`. Clicking one runs `fitView` to the decision's task node, selects it and flashes it (`hv-flash`).
- The composer sits at the bottom. Enter sends `POST /api/chat {text, by}`; the composer is disabled while sending, and the thread auto-scrolls to the newest message.
- Between sending and the reply, show a three-dot "Planner is thinking…" bubble.

**ConflictCard.tsx.** One card per conflict whose `status !== 'resolved'`, floating over the graph at top center and entering with `hv-pop-in` and a slight tilt.
- Header: the file names.
- Body: the hunks split into "ours" and "theirs" columns (parse the `<<<<<<<`, `=======` and `>>>>>>>` markers), then the proposal.
- Footer: if `auto-resolved`, a green sticker reading "Tests pass, applied" plus the `rule`. Otherwise three buttons, **Ours**, **Theirs** and **Proposal**, each posting its choice.
- After resolution the card collapses to a pill.

**ShipBar.tsx.** `Run ready tasks` is a blue button that sends `POST /api/run {}`. `Approve and push` is a hot button that sends `POST /api/push {by}`, shows a spinner while pending and, on success, shows the commit URL as a link. A QR code for the link is optional and is the first thing to cut.

**Presence.tsx.** Overlapping round avatars with ink borders and initials; hovering shows the name. The agents (Planner and Builder) appear with a robot glyph and get a pulsing ring while any run is `running` or a Planner reply is pending.

## Status: big and readable from the back of the room

Keep a single map in `Status.tsx` and use it for nodes, the panel and everywhere else. **Always show color plus a text label**, never color alone. Labels are Space Mono uppercase.

| RunStatus | Fill | Text | Label | Motion |
|---|---|---|---|---|
| `todo` | paper `#fffdf8` | ink | TO DO | none |
| `ready` | cream `#f5efe4` | ink | READY | gentle `hv-drift` |
| `running` | blue `#2563eb` | white | BUILDING… | `hv-pulse-ring` + animated edge |
| `stale` | hot `#ff5c1a` | ink | STALE · REBUILDING | `hv-wiggle` once, then pulse |
| `done` | green `#22c55e` | ink | DONE ✓ | `hv-settle` once on entering |
| `failed` | red `#ef4444` | white | FAILED | `hv-shake` once |
| `blocked` | ink `#14121a` | cream | BLOCKED | none |
| assigned to a person | paper, dashed border | ink | HUMAN | none |

A status change animates **once** on the transition (trigger it by keying the class on the status), not continuously. The only looping status is `running`.

## Visual style: BloxClips-inspired cartoon

Reference: bloxclips.com. Flat colors, thick ink outlines, **hard offset shadows with no blur**, pill buttons, slightly tilted stickers and cards, bouncy overshoot easing and dot-grid backgrounds. Playful, but always legible.

### Tokens (`app/globals.css`)

```css
:root {
  --ink: #14121a;   --paper: #fffdf8;  --cream: #f5efe4;
  --blue: #2563eb;  --hot: #ff5c1a;    --green: #22c55e;  --red: #ef4444;
  --border: 3px;
  --shadow-sm: 3px 3px 0 var(--ink);
  --shadow: 6px 6px 0 var(--ink);
  --shadow-lg: 10px 10px 0 var(--ink);
  --r-sm: 10px; --r-md: 18px; --r-card: 28px; --r-full: 999px;
  --ease: cubic-bezier(.32,.72,0,1);        /* smooth settle */
  --bounce: cubic-bezier(.34,1.57,.64,1);   /* hover and press */
  --pop: cubic-bezier(.34,2.27,.64,1);      /* entrances, icon nudges */
  --fast: .2s; --hover: .3s; --reveal: .6s;
}
```

Page background: cream with the dot field (`radial-gradient(var(--ink) 1.2px, transparent 1.3px)` at `28px 28px`, about 0.12 opacity). Top bar: cream with a `var(--border)` ink bottom border. Ink borders separate the columns; there are no gaps between them.

### Components

- **`.hv-btn`**: a pill with a `var(--border) solid var(--ink)` border, Rubik 700, `letter-spacing: -0.02em`, `min-height: 2.75rem` and `box-shadow: 4px 4px 0 var(--ink)`. Variants: `--blue`, `--hot`, `--ink`, `--paper`.
  - hover: `translate: -2px -2px; box-shadow: 7px 7px 0 var(--ink)` with `var(--hover) var(--bounce)`
  - active: `translate: 3px 3px; box-shadow: 1px 1px 0 var(--ink)` over 80 ms
  - a trailing arrow icon nudges `translate: 4px` on hover with `--pop`
  - disabled: 50% opacity and no lift
- **`.hv-card`**: paper fill, ink border, `--r-card` radius (nodes use `--r-md`) and `--shadow`. On dark fills the shadow becomes `rgba(255,255,255,.35)`.
- **`.hv-sticker`**: a pill in Space Mono uppercase with `letter-spacing: .06em`, a 2px ink border, `--shadow-sm` and `rotate: var(--tilt, 0deg)`. Used for statuses, cite ids, op chips and file names.
- **Tilt**: decorative cards and stickers get a small tilt between -3° and 3°, derived from a hash of their id so it's stable. Never tilt text inputs, the diff or the test output.
- **Inputs**: paper fill, a 2px ink border and `--r-sm` radius. On focus, add `--shadow-sm` and a blue border instead of the browser glow.
- **Headings**: Rubik 800 with tight tracking (`-0.03em`). A highlighted word can sit in a paper "word box" with an ink border and a `.09em` shadow, like the BloxClips hero.

### Motion (keyframes in `globals.css`)

| Name | Use | Definition sketch |
|---|---|---|
| `hv-pop-in` | new node, chat bubble, conflict card | `from {opacity:0; scale:.85; translate:0 8px}` → `to {opacity:1; scale:1}`, `.42s var(--pop)` |
| `hv-slide-in` | TaskPanel | `from {translate: 24px 0; opacity:0}`, `var(--reveal) var(--ease)` |
| `hv-drift` | ready nodes, floating stickers | `translateY(0) → -6px → 0`, 6–8 s, ease-in-out, randomized negative delay |
| `hv-pulse-ring` | running node, busy agent avatar | a box-shadow ring that expands and fades, 1.4 s, infinite |
| `hv-settle` | status → done | `scale 1 → 1.055 → 1`, `.5s var(--bounce)` |
| `hv-wiggle` | status → stale | `rotate 0 → -3° → 3° → 0`, `.5s` |
| `hv-shake` | failed, rejected edge | `translateX ±4px` × 3, `.35s` |
| `hv-flash` | cited decision focus | ink outline plus a hot glow that pulses twice |

Rules:
- Animate only `translate`, `scale`, `rotate` and `opacity`, never layout properties.
- Keep every non-looping animation under 0.6 s.
- Wrap all non-essential motion in `@media (prefers-reduced-motion: no-preference)`. Statuses must stay readable with motion off.

## Build order (each step has a visible result)

1. **Shell**: fonts, tokens, the top bar, three columns, and `.hv-btn`, `.hv-card` and `.hv-sticker`. *Verify:* the page looks like BloxClips, with placeholder content.
2. **Live graph**: tasks become nodes and edges, and dragging writes x/y. *Verify:* two windows move the same node live.
3. **TaskPanel**: opens on click; edit title and spec, why prompt, assignee. *Verify:* edits and the quote appear in the other window.
4. **Presence**: avatars and `openTaskId` dots on nodes. *Verify:* the Ana, Ben and Cal avatars show, and Ben's dot sits on the node Ben opened.
5. **Chat**: thread, send, op chips, thinking bubble. *Verify:* the demo request posts and the Planner's nodes pop in. (**CP1**)
6. **Status colors and motion**, plus the diff and test output in the panel. *Verify:* Run turns nodes blue, then green with hashes; changing a spec mid-build turns Stats and its dependent orange. (**CP2**)
7. **ConflictCard, ShipBar and cite links.** *Verify:* the conflict card shows both hunks and "tests pass, applied"; Approve and push shows the commit link; clicking a cited id focuses its node. (**CP3**)
8. **Polish for the room**: check at 125% zoom; node labels at least 14 px and panel status stickers at least 16 px.

After each step: run `pnpm --filter web typecheck`, check in two windows, then commit.

## Cut order (if behind)

QR code → drag-to-connect edges (edges only from chat) → side-by-side hunk parsing (show the raw hunks) → decorative drift and tilt. Status labels and colors are never cut.
