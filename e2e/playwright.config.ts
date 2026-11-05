import { defineConfig, devices } from '@playwright/test';
import { E2E_DATABASE_URL, E2E_REDIS_URL, JWT_ACCESS_SECRET } from './env.mjs';

/**
 * Runs the built apps on their normal ports (the Next proxies are baked at build time), against a disposable
 * e2e database. Stop any dev servers first.
 */
const root = '..';
const next = (app: string, port: number) => ({
  command: `node ${root}/apps/${app}/.next/standalone/apps/${app}/server.js`,
  url: `http://127.0.0.1:${port}${app === 'dashboard' ? '/login' : '/'}`,
  env: { PORT: String(port), HOSTNAME: '127.0.0.1' },
  reuseExistingServer: false,
  timeout: 60_000,
});

export default defineConfig({
  testDir: './tests',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 15_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `node ${root}/apps/api/dist/src/main.js`,
      url: 'http://127.0.0.1:4000/health/ready',
      env: {
        DATABASE_URL: E2E_DATABASE_URL,
        REDIS_URL: E2E_REDIS_URL,
        JWT_ACCESS_SECRET,
        NODE_ENV: 'test',
        PORT: '4000',
        LOG_LEVEL: 'warn',
        CORS_ORIGINS: 'http://localhost:3000,http://localhost:3001,http://localhost:3002',
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    next('dashboard', 3000),
    next('guest', 3001),
    next('staff', 3002),
  ],
});
