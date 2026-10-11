// Delete every project (its doc, workspace, worktrees and session transcripts) so the next start has no projects.
// The older single-project files (doc.bin, workspace/ ...) are removed too.
import { rmSync } from 'node:fs';

for (const p of ['projects.json', 'projects', 'epoch.txt', 'doc.bin', 'repo.json', 'workspace', 'worktrees', 'sessions']) {
  rmSync(new URL(`../data/${p}`, import.meta.url), { recursive: true, force: true });
}
console.log('Reset: all projects removed. Restart `pnpm dev` to start fresh.');
