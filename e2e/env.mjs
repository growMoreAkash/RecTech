// Shared by prepare.mjs and playwright.config.ts. The database name must contain "e2e": it is wiped and re-seeded.
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/dinesense_e2e';
export const E2E_REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/14';
export const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'e2e-only-access-secret-0123456789abcdef';
