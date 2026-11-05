// Test environment. TEST_DATABASE_URL must point at a disposable database; it is reset before the run.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/dinesense_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-that-is-at-least-32-chars';
process.env.LOG_LEVEL = 'silent';
process.env.PIN_MAX_ATTEMPTS = '3';

export {};
