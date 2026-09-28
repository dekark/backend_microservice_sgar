import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "pg";
import type { PoolClient } from "pg";

export interface AuditContext {
  requestId: string;
  source: string;
  actor: () => { userId: string | null; areaId: string | null };
}
export const auditContext = new AsyncLocalStorage<AuditContext>();

type ConnectCallback = (
  error: Error | undefined,
  client: PoolClient | undefined,
  release: (error?: Error | boolean) => void,
) => void;

// Set context on EVERY checkout, including anonymous/background work. Never trust
// user IDs from request bodies or leave an earlier borrower's context on the pool.
export class AuditedPool extends Pool {
  override connect(): Promise<PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    const context = auditContext.getStore();
    const value = context
      ? {
          requestId: context.requestId,
          source: context.source,
          ...context.actor(),
        }
      : {};
    const acquire = async () => {
      const client = await super.connect();
      try {
        await client.query(
          "SELECT set_config('app.audit_context', $1, false)",
          [JSON.stringify(value)],
        );
        return client;
      } catch (error) {
        client.release(true);
        throw error;
      }
    };
    if (!callback) return acquire();
    void acquire().then(
      (client) => callback(undefined, client, client.release.bind(client)),
      (error) =>
        callback(
          error instanceof Error
            ? error
            : new Error("Database context unavailable"),
          undefined,
          () => undefined,
        ),
    );
  }
}
