import { AuditedPool } from "./audit-context";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

// Authentication needs row locks and interactive transactions (HTTP does not support them).
export function createTransactionalDatabase(databaseUrl: string) {
  const pool = new AuditedPool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
  });
  return { pool, db: drizzle(pool, { schema }) };
}
export type TransactionalDatabase = ReturnType<
  typeof createTransactionalDatabase
>["db"];
export type DatabaseTransaction = Parameters<
  Parameters<TransactionalDatabase["transaction"]>[0]
>[0];
