import { defineConfig } from 'vitest/config';

// Only the server's own tests: the workspace template's node:test files are not vitest tests.
export default defineConfig({ test: { include: ['*.test.ts'] } });
