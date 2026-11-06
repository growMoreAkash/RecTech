import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required so Nest's decorator metadata (constructor injection) works under Vitest.
const plugins = [swc.vite({ module: { type: 'es6' } })];

export default defineConfig({
  test: {
    // Integration files share one database; run files sequentially (root-level option in Vitest 3).
    fileParallelism: false,
    projects: [
      {
        plugins,
        test: { name: 'unit', include: ['src/**/*.spec.ts'], setupFiles: ['test/env.ts'] },
      },
      {
        plugins,
        test: {
          name: 'integration',
          include: ['test/**/*.int.ts'],
          setupFiles: ['test/env.ts'],
          globalSetup: ['test/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
