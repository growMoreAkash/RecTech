import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads the repo-root `.env` (then a package-local one) into process.env if present.
 * Already-set variables win, so Docker/CI environment always overrides the file.
 */
export function loadDotenv(cwd = process.cwd()): void {
  for (const file of [resolve(cwd, '.env'), resolve(cwd, '../../.env')]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
