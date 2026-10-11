// Delete the saved doc so the next server start loads shared/seed.json.
import { rmSync } from 'node:fs';

rmSync(new URL('../data/doc.bin', import.meta.url), { force: true });
console.log('Reset: data/doc.bin removed. Restart `pnpm dev` to load the seed.');
