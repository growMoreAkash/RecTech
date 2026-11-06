/**
 * Prepares a disposable e2e environment:
 *  1. migrate + seed the e2e database (refuses any database whose name lacks "e2e");
 *  2. copy static assets into each Next standalone bundle (Next does not do this itself).
 * Run after `pnpm build`.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_DATABASE_URL, JWT_ACCESS_SECRET } from '../env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dbName = new URL(E2E_DATABASE_URL).pathname.slice(1);
if (!dbName.includes('e2e'))
  throw new Error(`Refusing to seed "${dbName}": the e2e database name must contain "e2e"`);

const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL, JWT_ACCESS_SECRET, NODE_ENV: 'test' };
const api = join(root, 'apps', 'api');
execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: api, env, stdio: 'inherit' });
execFileSync('pnpm', ['exec', 'tsx', 'prisma/seed.ts'], { cwd: api, env, stdio: 'inherit' });
// The seed's shifts are 11:00–23:00 IST; check-in opens an hour early. Make today's shifts cover "now" so the
// suite passes at any hour (e2e database only — guarded above).
execFileSync('pnpm', ['exec', 'prisma', 'db', 'execute', '--stdin', '--url', E2E_DATABASE_URL], {
  cwd: api,
  env,
  input: `UPDATE "Shift" SET "startsAt" = now() - interval '1 hour', "endsAt" = now() + interval '11 hours';`,
  stdio: ['pipe', 'inherit', 'inherit'],
});

for (const app of ['dashboard', 'guest', 'staff']) {
  const src = join(root, 'apps', app);
  const out = join(src, '.next', 'standalone', 'apps', app);
  if (!existsSync(out)) throw new Error(`Missing ${out} — run "pnpm build" first`);
  rmSync(join(out, '.next', 'static'), { recursive: true, force: true });
  cpSync(join(src, '.next', 'static'), join(out, '.next', 'static'), { recursive: true });
  if (existsSync(join(src, 'public'))) cpSync(join(src, 'public'), join(out, 'public'), { recursive: true });
}
console.log('e2e environment ready');
