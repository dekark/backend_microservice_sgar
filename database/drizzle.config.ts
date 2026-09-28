import 'dotenv/config';

import {
  env,
} from 'node:process';

import {
  defineConfig,
} from 'drizzle-kit';

export default defineConfig({
  schema:
    './src/schema.ts',

  out:
    './drizzle',

  dialect:
    'postgresql',

  dbCredentials: {
    url:
      env.DATABASE_URL!,
  },
});