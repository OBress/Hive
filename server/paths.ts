import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_DIR = fileURLToPath(new URL('.', import.meta.url));
export const DATA_DIR = process.env.HIVE_DATA_DIR || join(SERVER_DIR, '..', 'data');   // the smoke test uses its own
export const TEMPLATE = join(SERVER_DIR, 'workspace-template');
