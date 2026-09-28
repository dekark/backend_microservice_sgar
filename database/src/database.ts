import { neon } from '@neondatabase/serverless';

import {
  drizzle,
} from 'drizzle-orm/neon-http';

import * as schema from './schema';

export function createDatabase(
  databaseUrl: string,
) {
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL no está configurado',
    );
  }

  const sql = neon(databaseUrl);

  return drizzle({
    client: sql,
    schema,
  });
}

export type Database =
  ReturnType<typeof createDatabase>;