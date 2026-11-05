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
  /** Derives each edge device's HMAC secret (≥32 chars). Defaults to a key derived from JWT_ACCESS_SECRET in dev. */
  EDGE_SECRET_KEY: z.string().min(32).optional(),
  /** AES-256-GCM key for camera RTSP URLs at rest: 32 bytes, base64. Defaults to a JWT-derived key in dev. */
  CAMERA_SECRET_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'CAMERA_SECRET_KEY must be 32 bytes, base64')
    .optional(),
  /** Camera/edge offline sweep interval (seconds; 0 disables). */
  EDGE_HEALTH_SWEEP_SECONDS: z.coerce.number().int().min(0).default(30),
  /** Web Push (VAPID). Push is disabled when the keys are absent; sockets still work. */
  VAPID_PUBLIC_KEY: z.string().min(20).optional(),
  VAPID_PRIVATE_KEY: z.string().min(20).optional(),
  VAPID_SUBJECT: z.string().default('mailto:ops@example.com'),
  /** How often guest data past its retention period is erased (seconds; 0 disables). */
  GUEST_RETENTION_SWEEP_SECONDS: z.coerce.number().int().min(0).default(3600),
  /** How often table holds / no-shows for bookings are processed (seconds; 0 disables, tests call sweep()). */
  RESERVATION_SWEEP_SECONDS: z.coerce.number().int().min(0).default(30),
  /** Public URL of the guest app (links in messages: manage booking, waitlist status). */
  GUEST_APP_URL: z.string().url().default('http://localhost:3001'),
  /**
   * WhatsApp Cloud API (PAID SERVICE: Meta charges per conversation). Without these, messages go to the console
   * channel (logged and recorded, never sent). Owner approved building against the console channel first.
   */
  WHATSAPP_ACCESS_TOKEN: z.string().min(10).optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(3).optional(),
  WHATSAPP_APP_SECRET: z.string().min(8).optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().min(8).optional(),
  WHATSAPP_API_URL: z.string().url().default('https://graph.facebook.com/v21.0'),
  /** How often queued guest messages are sent (seconds; 0 disables — tests call dispatch()). */
  MESSAGE_DISPATCH_SECONDS: z.coerce.number().int().min(0).default(5),
  /**
   * Razorpay (PAID SERVICE: per-transaction fees on live keys). Online payment is off unless all three are set.
   * Use test-mode keys (rzp_test_…) until the owner approves going live.
   */
  RAZORPAY_KEY_ID: z.string().min(8).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(8).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(8).optional(),
  RAZORPAY_API_URL: z.string().url().default('https://api.razorpay.com/v1'),
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
