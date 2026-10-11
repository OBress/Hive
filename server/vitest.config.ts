import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// Only the server's own tests: the workspace template's node:test files are not vitest tests.
// Tests that touch data/ (e.g. users.json via the auth middleware) write to a temp dir, never the real one.
export default defineConfig({ test: { include: ['*.test.ts'], env: { HIVE_DATA_DIR: join(tmpdir(), 'hive-vitest-data') } } });
