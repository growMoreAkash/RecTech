import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  /**
   * A rotated refresh token presented again within this window is treated as a lost response (navigation, flaky
   * network) and the session continues. Later reuse is treated as theft and revokes the whole family.
   */
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(300).default(20),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:3001,http://localhost:3002')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  PIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  PIN_LOCKOUT_SECONDS: z.coerce.number().int().min(10).default(900),
  /** Express `trust proxy`: which hops may set X-Forwarded-For (rate limits key on the client IP). */
  TRUST_PROXY: z.string().default('loopback, uniquelocal'),
  /** Greet-SLA engine: run the BullMQ worker in this process (turn off on API replicas that should not). */
  SLA_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Safety-net sweep interval; 0 disables (tests). */
  SLA_RECONCILE_SECONDS: z.coerce.number().int().min(0).default(30),
  /** Redis key prefix for BullMQ queues (separate apps/tests sharing a Redis). */
  BULLMQ_PREFIX: z.string().default('dinesense'),
  /** Web Push (VAPID). Push is disabled when the keys are absent; sockets still work. */
  VAPID_PUBLIC_KEY: z.string().min(20).optional(),
  VAPID_PRIVATE_KEY: z.string().min(20).optional(),
  VAPID_SUBJECT: z.string().default('mailto:ops@example.com'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
