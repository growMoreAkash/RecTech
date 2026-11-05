import { defineConfig } from 'prisma/config';
import { loadDotenv } from './src/config/load-dotenv';

// With a config file present Prisma no longer auto-loads .env, so load the repo-root one explicitly.
loadDotenv(__dirname);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
});
