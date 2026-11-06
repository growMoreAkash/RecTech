import next from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import { base } from '@dinesense/config/eslint';

export default [
  { ignores: ['.next/**', 'next-env.d.ts'] },
  ...base(import.meta.dirname),
  {
    plugins: { '@next/next': next, 'react-hooks': reactHooks },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
    },
  },
];
