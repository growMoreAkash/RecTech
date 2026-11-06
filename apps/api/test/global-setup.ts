import { execFileSync } from 'node:child_process';

/**
 * Bring the test database up to the current migrations. Non-destructive by design:
 * every test creates its own organization (see fixtures.createTenant), so no reset or truncation is needed,
 * and test runs never delete data. Point TEST_DATABASE_URL at a disposable database anyway.
 */
export default async function setup(): Promise<void> {
  await import('./env');
  const url = process.env.DATABASE_URL!;
  if (!/test/.test(url))
    throw new Error(`Refusing to run integration tests against a non-test database: ${url}`);
  try {
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: url },
    });
  } catch (e) {
    // Surface Prisma's own message instead of a bare "Command failed".
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `prisma migrate deploy failed:\n${err.stdout?.toString() ?? ''}\n${err.stderr?.toString() ?? ''}`,
    );
  }
}
