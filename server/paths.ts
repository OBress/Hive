import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_DIR = fileURLToPath(new URL('.', import.meta.url));
export const DATA_DIR = process.env.HIVE_DATA_DIR || join(SERVER_DIR, '..', 'data');   // the smoke test uses its own
export const DOC_FILE = join(DATA_DIR, 'doc.bin');
export const WORKSPACE = join(DATA_DIR, 'workspace');
export const WORKTREES = join(DATA_DIR, 'worktrees');
export const SESSIONS_DIR = join(DATA_DIR, 'sessions');
export const TEMPLATE = join(SERVER_DIR, 'workspace-template');
