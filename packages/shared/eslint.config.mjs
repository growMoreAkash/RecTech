import { base } from '@dinesense/config/eslint';
export default [{ ignores: ['scripts/**'] }, ...base(import.meta.dirname)];
