export const APPLICATION_SOURCES = [
  "auth-service",
  "roles-service",
  "permissions-service",
  "resources-service",
  "areas-service",
  "users-service",
  "audit-service",
  "database",
] as const;
export const AUDIT_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface ApplicationEvent {
  eventId: string;
  version: 1;
  source: (typeof APPLICATION_SOURCES)[number];
  action:
    | "http.accepted"
    | "http.completed"
    | "http.aborted"
    | "rpc.completed"
    | "data.created"
    | "data.updated"
    | "data.deleted";
  occurredAt: string;
  requestId: string | null;
  userId: string | null;
  areaId: string | null;
  entity: string;
  entityId: string | null;
  metadata: {
    method?: string;
    route?: string;
    statusCode?: number;
    durationMs?: number;
    changedFields?: string[];
  };
}
export class InvalidApplicationEventError extends Error {}
const actions = [
  "http.accepted",
  "http.completed",
  "http.aborted",
  "rpc.completed",
  "data.created",
  "data.updated",
  "data.deleted",
];
const entities = [
  "http",
  "roles",
  "permissions",
  "role_permissions",
  "areas",
  "users",
  "resources",
  "audit_logs",
  "user_sessions",
  "refresh_tokens",
];
const fields = [
  "name",
  "description",
  "is_active",
  "key",
  "module",
  "role_id",
  "permission_id",
  "area_id",
  "type",
  "status",
  "url",
  "s3_bucket",
  "s3_key",
  "original_file_name",
  "mime_type",
  "file_size",
  "image_s3_bucket",
  "image_s3_key",
  "image_mime_type",
  "image_file_size",
  "avatar_s3_bucket",
  "avatar_s3_key",
  "avatar_mime_type",
  "avatar_file_size",
  "action",
  "entity",
  "entity_id",
  "metadata",
  "expires_at",
  "revoked_at",
  "last_active_at",
  "last_login_at",
  "email",
  "google_sub",
  "token_hash",
  "session_id",
  "user_id",
  "updated_at",
  "created_at",
  "id",
  "auth_provider",
  "ip_address",
  "user_agent",
  "created_by_id",
];

// Strict, bounded, canonical payload: no arbitrary metadata, bodies or credentials.
export function parseApplicationEvent(value: unknown): ApplicationEvent {
  const invalid = (): never => {
    throw new InvalidApplicationEventError("Invalid application event");
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const e = value as Record<string, unknown>;
  const keys = [
    "eventId",
    "version",
    "source",
    "action",
    "occurredAt",
    "requestId",
    "userId",
    "areaId",
    "entity",
    "entityId",
    "metadata",
  ];
  if (
    Object.keys(e).some((key) => !keys.includes(key)) ||
    e.version !== 1 ||
    !APPLICATION_SOURCES.includes(e.source as ApplicationEvent["source"]) ||
    !actions.includes(e.action as string) ||
    !entities.includes(e.entity as string)
  )
    return invalid();
  for (const key of ["eventId", "requestId", "userId", "areaId"]) {
    if (e[key] === null && key !== "eventId") continue;
    if (typeof e[key] !== "string" || !AUDIT_UUID.test(e[key]))
      return invalid();
  }
  if (
    typeof e.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(e.occurredAt)) ||
    new Date(e.occurredAt).toISOString() !== e.occurredAt
  )
    return invalid();
  if (
    e.entityId !== null &&
    (typeof e.entityId !== "string" ||
      !/^[a-zA-Z0-9:_-]{1,255}$/.test(e.entityId))
  )
    return invalid();
  if (
    !e.metadata ||
    typeof e.metadata !== "object" ||
    Array.isArray(e.metadata)
  )
    return invalid();
  const m = e.metadata as Record<string, unknown>;
  if (
    Object.keys(m).some(
      (key) =>
        ![
          "method",
          "route",
          "statusCode",
          "durationMs",
          "changedFields",
        ].includes(key),
    )
  )
    return invalid();
  if (
    m.method !== undefined &&
    ![
      "GET",
      "POST",
      "PATCH",
      "PUT",
      "DELETE",
      "OPTIONS",
      "HEAD",
      "OTHER",
    ].includes(m.method as string)
  )
    return invalid();
  if (
    m.route !== undefined &&
    (typeof m.route !== "string" ||
      m.route.length > 200 ||
      !/^[/a-zA-Z0-9:_.*{}-]+$/.test(m.route))
  )
    return invalid();
  if (
    m.statusCode !== undefined &&
    (!Number.isInteger(m.statusCode) ||
      Number(m.statusCode) < 100 ||
      Number(m.statusCode) > 599)
  )
    return invalid();
  if (
    m.durationMs !== undefined &&
    (!Number.isSafeInteger(m.durationMs) || Number(m.durationMs) < 0)
  )
    return invalid();
  if (
    m.changedFields !== undefined &&
    (!Array.isArray(m.changedFields) ||
      m.changedFields.length > fields.length ||
      m.changedFields.some((f) => !fields.includes(f)))
  )
    return invalid();
  return {
    eventId: (e.eventId as string).toLowerCase(),
    version: 1,
    source: e.source as ApplicationEvent["source"],
    action: e.action as ApplicationEvent["action"],
    occurredAt: e.occurredAt,
    requestId:
      e.requestId === null ? null : (e.requestId as string).toLowerCase(),
    userId: e.userId === null ? null : (e.userId as string).toLowerCase(),
    areaId: e.areaId === null ? null : (e.areaId as string).toLowerCase(),
    entity: e.entity as string,
    entityId: e.entityId as string | null,
    metadata: {
      ...(m.method === undefined ? {} : { method: m.method as string }),
      ...(m.route === undefined ? {} : { route: m.route as string }),
      ...(m.statusCode === undefined
        ? {}
        : { statusCode: m.statusCode as number }),
      ...(m.durationMs === undefined
        ? {}
        : { durationMs: m.durationMs as number }),
      ...(m.changedFields === undefined
        ? {}
        : { changedFields: [...new Set(m.changedFields as string[])].sort() }),
    },
  };
}
