import { base } from '@dinesense/config/eslint';
export default [
  { ignores: ['test-results/**', 'playwright-report/**', 'scripts/**', '*.mjs'] },
  ...base(import.meta.dirname),
];
