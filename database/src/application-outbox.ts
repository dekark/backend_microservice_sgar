import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { auditContext } from "./audit-context";
import { AUDIT_UUID, parseApplicationEvent } from "./application-event";
import type { ApplicationEvent } from "./application-event";

export interface AuditHttpRequest {
  method: string;
  user?: { id: string; areaId?: string | null };
  route?: { path?: unknown };
  params?: Record<string, unknown>;
}
export interface AuditHttpResponse {
  statusCode: number;
  writableFinished: boolean;
  destroyed: boolean;
  once(event: string, listener: () => void): unknown;
  setHeader(name: string, value: string): unknown;
}
export type EventDestination = "kafka" | "rabbit";
export type ApplicationPublisher = (
  destination: EventDestination,
  event: ApplicationEvent,
) => Promise<void>;

export class ApplicationOutbox {
  private readonly pending = new Set<Promise<void>>();
  constructor(
    private readonly pool: Pool,
    private readonly source: ApplicationEvent["source"],
    private readonly report: (message: string) => void,
  ) {}

  async enqueue(event: ApplicationEvent): Promise<void> {
    const canonical = parseApplicationEvent(event);
    // Both destinations are saved atomically, before attempting network delivery.
    await this.pool.query(
      `INSERT INTO application_outbox (event_id, source, destination, payload)
      VALUES ($1, $2, 'kafka', $3::jsonb), ($1, $2, 'rabbit', $3::jsonb)
      ON CONFLICT (event_id, destination) DO NOTHING`,
      [canonical.eventId, canonical.source, JSON.stringify(canonical)],
    );
  }

  trackHttp(
    request: AuditHttpRequest,
    response: AuditHttpResponse,
    next: (error?: Error) => void,
  ): void {
    const requestId = randomUUID();
    const started = Date.now();
    const method = [
      "GET",
      "POST",
      "PATCH",
      "PUT",
      "DELETE",
      "OPTIONS",
      "HEAD",
    ].includes(request.method)
      ? request.method
      : "OTHER";
    const actor = () => ({
      userId:
        request.user && AUDIT_UUID.test(request.user.id)
          ? request.user.id
          : null,
      areaId:
        request.user?.areaId && AUDIT_UUID.test(request.user.areaId)
          ? request.user.areaId
          : null,
    });
    response.setHeader("X-Request-Id", requestId);
    const event = (action: ApplicationEvent["action"]): ApplicationEvent => ({
      eventId: randomUUID(),
      version: 1,
      source: this.source,
      action,
      occurredAt: new Date().toISOString(),
      requestId,
      ...actor(),
      entity: "http",
      entityId: null,
      metadata: { method },
    });
    // A durable accepted event remains if the process dies before finish/close.
    const work = auditContext.run(
      { requestId, source: this.source, actor },
      async () => {
        try {
          await this.enqueue(event("http.accepted"));
        } catch {
          this.report(`Audit admission unavailable: ${requestId}`);
          next(
            Object.assign(new Error("Auditoria no disponible"), {
              status: 503,
              statusCode: 503,
            }),
          );
          return;
        }
        let completed = false;
        const finish = () => {
          if (completed) return;
          completed = true;
          const outcome = event(
            response.writableFinished ? "http.completed" : "http.aborted",
          );
          const route = request.route?.path;
          const target =
            request.params?.id ??
            request.params?.sessionId ??
            request.params?.roleId;
          if (
            typeof target === "string" &&
            (AUDIT_UUID.test(target) || /^[1-9][0-9]{0,9}$/.test(target))
          ) {
            const entities: Record<string, string> = {
              "auth-service": "user_sessions",
              "roles-service": "roles",
              "permissions-service": "permissions",
              "areas-service": "areas",
              "users-service": "users",
              "resources-service": "resources",
              "audit-service": "audit_logs",
            };
            outcome.entity = entities[this.source] ?? "http";
            outcome.entityId = target;
          }
          outcome.metadata = {
            method,
            // Only the router template, never the URL, query, body, header or file.
            route:
              typeof route === "string" &&
              route.length <= 200 &&
              /^[/a-zA-Z0-9:_.*{}-]+$/.test(route)
                ? route
                : "/unmatched",
            statusCode: response.statusCode,
            durationMs: Math.max(0, Date.now() - started),
          };
          this.background(
            this.enqueue(outcome),
            `Audit outcome unavailable: ${requestId}`,
          );
        };
        response.once("finish", finish);
        response.once("close", finish);
        if (response.destroyed) {
          finish();
          return;
        }
        next();
      },
    );
    this.background(work, `Audit request unavailable: ${requestId}`);
  }

  private background(work: Promise<void>, failure: string) {
    const pending = work
      .catch(() => this.report(failure))
      .finally(() => this.pending.delete(pending));
    this.pending.add(pending);
  }
  async drain() {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  async deliver(publish: ApplicationPublisher): Promise<void> {
    const claim = randomUUID();
    const { rows } = await this.pool.query<{
      id: string;
      destination: EventDestination;
      payload: ApplicationEvent;
    }>(
      `WITH candidates AS (
        SELECT id FROM application_outbox
        WHERE published_at IS NULL AND available_at <= now()
          AND (locked_until IS NULL OR locked_until < now())
          AND (source = $1 OR ($1 = 'audit-service' AND source = 'database'))
        ORDER BY available_at, created_at LIMIT 10 FOR UPDATE SKIP LOCKED
      ) UPDATE application_outbox o SET claimed_by = $2,
        locked_until = now() + interval '120 seconds'
      FROM candidates c WHERE o.id = c.id RETURNING o.id, o.destination, o.payload`,
      [this.source, claim],
    );
    for (const row of rows) {
      try {
        await publish(row.destination, parseApplicationEvent(row.payload));
        await this.pool.query(
          `UPDATE application_outbox SET published_at = now(), claimed_by = NULL, locked_until = NULL
          WHERE id = $1 AND claimed_by = $2`,
          [row.id, claim],
        );
      } catch {
        await this.pool.query(
          `UPDATE application_outbox SET attempts = attempts + 1,
          available_at = now() + make_interval(secs => LEAST(300, power(2, LEAST(attempts + 1, 8)))::int),
          claimed_by = NULL, locked_until = NULL WHERE id = $1 AND claimed_by = $2`,
          [row.id, claim],
        );
        this.report(`Audit delivery pending: ${row.destination}, ${row.id}`);
      }
    }
  }
}
