// Test environment. TEST_DATABASE_URL must point at a disposable database; it is reset before the run.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/dinesense_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-that-is-at-least-32-chars';
process.env.LOG_LEVEL = 'silent';
process.env.PIN_MAX_ATTEMPTS = '3';
// SLA: the worker runs (one test waits for a real timer), the periodic sweep is off, queues isolated from dev.
process.env.SLA_RECONCILE_SECONDS = '0';
process.env.BULLMQ_PREFIX = 'dinesense-test';
process.env.EDGE_HEALTH_SWEEP_SECONDS = '0';
process.env.GUEST_RETENTION_SWEEP_SECONDS = '0';
process.env.RESERVATION_SWEEP_SECONDS = '0';
process.env.MESSAGE_DISPATCH_SECONDS = '0';
process.env.SERVICE_SWEEP_SECONDS = '0';
// Real-looking VAPID keys so push is "enabled"; tests swap the sender for a spy, nothing leaves the machine.
process.env.VAPID_PUBLIC_KEY ??=
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
process.env.VAPID_PRIVATE_KEY ??= 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls';
// Razorpay test credentials (fake); the payments test points RAZORPAY_API_URL at a local mock server.
process.env.RAZORPAY_KEY_ID ??= 'rzp_test_dinesense';
process.env.RAZORPAY_KEY_SECRET ??= 'test_key_secret_0123456789';
process.env.RAZORPAY_WEBHOOK_SECRET ??= 'test_webhook_secret_0123456789';
process.env.RAZORPAY_API_URL ??= 'http://127.0.0.1:9/v1';
// WhatsApp webhook secrets (fake). No access token → messages use the console channel; one test wires a mock API.
process.env.WHATSAPP_APP_SECRET ??= 'test_wa_app_secret_0123';
process.env.WHATSAPP_VERIFY_TOKEN ??= 'test_wa_verify_token';

export {};
