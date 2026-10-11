// Delete the saved doc, the agent workspace, worktrees and session transcripts so the next start is an empty graph.
import { rmSync } from 'node:fs';

for (const p of ['doc.bin', 'epoch.txt', 'workspace', 'worktrees', 'sessions']) {
  rmSync(new URL(`../data/${p}`, import.meta.url), { recursive: true, force: true });
}
console.log('Reset: data/doc.bin, workspace, worktrees and sessions removed. Restart `pnpm dev` to start fresh.');
