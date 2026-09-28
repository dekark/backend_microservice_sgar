import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { AUDIT_UUID } from "./application-event";

export const RPC_SERVICES = [
  "auth",
  "roles",
  "permissions",
  "resources",
  "areas",
  "users",
  "audit",
] as const;
export type RpcService = (typeof RPC_SERVICES)[number];
export interface BrokerCommand {
  version: 1;
  requestId: string;
  expiresAt: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  path: string;
  accessToken?: string;
  query?: Record<string, string | number | boolean | string[]>;
  body?: unknown;
  file?: { filename: string; contentType: string; base64: string };
}
export interface BrokerReply {
  requestId: string | null;
  statusCode: number;
  ok: boolean;
  data: unknown;
  auditRequestId?: string;
}
export const RPC_MESSAGE_BYTES = 512 * 1024;
export function parseBrokerReply(
  input: unknown,
  requestId: string,
): BrokerReply {
  const invalid = (): never => {
    throw new Error("Respuesta RPC invalida");
  };
  if (!input || typeof input !== "object" || Array.isArray(input))
    return invalid();
  const value = input as Record<string, unknown>;
  if (
    typeof value.statusCode !== "number" ||
    !Number.isInteger(value.statusCode) ||
    value.statusCode < 200 ||
    value.statusCode > 599 ||
    value.ok !== value.statusCode < 300 ||
    !Object.hasOwn(value, "data")
  )
    return invalid();
  if (value.requestId !== requestId && !(value.requestId === null && !value.ok))
    return invalid();
  if (
    value.auditRequestId !== undefined &&
    (typeof value.auditRequestId !== "string" ||
      !AUDIT_UUID.test(value.auditRequestId))
  )
    return invalid();
  return {
    requestId: value.requestId as string | null,
    statusCode: value.statusCode,
    ok: value.ok as boolean,
    data: value.data,
    ...(value.auditRequestId
      ? { auditRequestId: value.auditRequestId as string }
      : {}),
  };
}
export class InvalidBrokerCommand extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function parseBrokerCommand(
  input: unknown,
  now = Date.now(),
): BrokerCommand {
  const invalid = (): never => {
    throw new InvalidBrokerCommand(400, "Mensaje RPC invalido");
  };
  if (!input || typeof input !== "object" || Array.isArray(input))
    return invalid();
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "version",
          "requestId",
          "expiresAt",
          "method",
          "path",
          "accessToken",
          "query",
          "body",
          "file",
        ].includes(key),
    )
  )
    return invalid();
  if (Buffer.byteLength(JSON.stringify(value)) > RPC_MESSAGE_BYTES)
    throw new InvalidBrokerCommand(413, "Mensaje RPC demasiado grande");
  if (
    value.version !== 1 ||
    typeof value.requestId !== "string" ||
    !AUDIT_UUID.test(value.requestId)
  )
    return invalid();
  if (
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt))
  )
    return invalid();
  const deadline = Date.parse(value.expiresAt);
  if (deadline <= now)
    throw new InvalidBrokerCommand(408, "El comando ha vencido");
  if (deadline > now + 300000) return invalid();
  if (
    !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(
      value.method as string,
    )
  )
    return invalid();
  if (
    typeof value.path !== "string" ||
    value.path.length > 2000 ||
    !value.path.startsWith("/") ||
    value.path.startsWith("//") ||
    /[\\?#\s\u0000-\u001f]/.test(value.path)
  )
    return invalid();
  try {
    const decoded = decodeURIComponent(value.path);
    if (
      /[\\\u0000-\u001f]/.test(decoded) ||
      decoded.split("/").some((segment) => segment === "." || segment === "..")
    )
      return invalid();
  } catch {
    return invalid();
  }
  if (
    value.accessToken !== undefined &&
    (typeof value.accessToken !== "string" ||
      !value.accessToken ||
      value.accessToken.length > 16384 ||
      /\s/.test(value.accessToken))
  )
    return invalid();
  if (
    ["GET", "HEAD"].includes(value.method as string) &&
    (value.body !== undefined || value.file !== undefined)
  )
    return invalid();
  if (value.query !== undefined) {
    if (
      !value.query ||
      typeof value.query !== "object" ||
      Array.isArray(value.query)
    )
      return invalid();
    for (const [key, item] of Object.entries(value.query)) {
      if (
        !key ||
        key.length > 100 ||
        ["__proto__", "constructor", "prototype"].includes(key)
      )
        return invalid();
      if (!(
        typeof item === "string" ||
        typeof item === "boolean" ||
        (typeof item === "number" && Number.isFinite(item)) ||
        (Array.isArray(item) && item.every((v) => typeof v === "string"))
      ))
        return invalid();
    }
  }
  if (value.file !== undefined) {
    if (
      !value.file ||
      typeof value.file !== "object" ||
      Array.isArray(value.file) ||
      value.body !== undefined ||
      !["POST", "PUT"].includes(value.method as string)
    )
      return invalid();
    const file = value.file as Record<string, unknown>;
    if (
      Object.keys(file).some(
        (key) => !["filename", "contentType", "base64"].includes(key),
      )
    )
      return invalid();
    if (
      typeof file.filename !== "string" ||
      !file.filename ||
      file.filename.length > 255 ||
      /[\\/\r\n\u0000]/.test(file.filename)
    )
      return invalid();
    if (
      typeof file.contentType !== "string" ||
      !/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(file.contentType)
    )
      return invalid();
    if (
      typeof file.base64 !== "string" ||
      !file.base64 ||
      Buffer.from(file.base64, "base64").toString("base64") !== file.base64
    )
      return invalid();
    if (Buffer.byteLength(file.base64, "base64") > 256 * 1024)
      throw new InvalidBrokerCommand(
        413,
        "Archivo RPC supera 256 KiB; usa la subida HTTP",
      );
  }
  return input as BrokerCommand;
}

export function brokerRpcConfig(config: {
  get<T>(key: string): T | undefined;
}) {
  const enabled = config.get<string | boolean>("BROKER_RPC_ENABLED") ?? true;
  if (![true, false, "true", "false"].includes(enabled))
    throw new Error("BROKER_RPC_ENABLED invalido");
  const timeout = Number(config.get("BROKER_RPC_TIMEOUT_MS") ?? 30000);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120000)
    throw new Error("BROKER_RPC_TIMEOUT_MS invalido");
  return { enabled: enabled === true || enabled === "true", timeout };
}

// Dispatch through the real HTTP router on the same process so inherited guards,
// pipes, interceptors (including Multer), throttling and audit cannot be bypassed.
export class BrokerRpcExecutor {
  constructor(
    private readonly pool: Pool,
    private readonly service: RpcService,
    private readonly origin: string,
    private readonly timeoutMs = 30000,
    private readonly send: typeof fetch = fetch,
  ) {
    const url = new URL(origin);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("RPC solo permite el servidor local");
    this.origin = url.origin;
  }
  async execute(input: unknown): Promise<BrokerReply> {
    let command: BrokerCommand;
    try {
      command = parseBrokerCommand(input);
    } catch (error) {
      return {
        requestId: null,
        ok: false,
        statusCode:
          error instanceof InvalidBrokerCommand ? error.statusCode : 400,
        data: {
          message:
            error instanceof InvalidBrokerCommand
              ? error.message
              : "Mensaje RPC invalido",
        },
      };
    }
    const reply = (
      statusCode: number,
      data: unknown,
      auditRequestId?: string,
    ): BrokerReply => ({
      requestId: command.requestId,
      ok: statusCode >= 200 && statusCode < 300,
      statusCode,
      data,
      ...(auditRequestId ? { auditRequestId } : {}),
    });
    const mutation = !["GET", "HEAD"].includes(command.method);
    const digest = createHash("sha256")
      .update(JSON.stringify(command))
      .digest("hex");
    if (mutation) {
      try {
        const inserted = await this.pool.query(
          `INSERT INTO broker_commands (service, request_id, request_hash)
          VALUES ($1, $2, $3) ON CONFLICT (service, request_id) DO NOTHING RETURNING request_id`,
          [this.service, command.requestId, digest],
        );
        if (!inserted.rows.length)
          return reply(409, {
            message:
              "requestId ya recibido; no se vuelve a ejecutar. Consulta el estado del recurso antes de reenviar.",
          });
      } catch {
        return reply(503, { message: "Registro de comandos no disponible" });
      }
    }
    let result: BrokerReply;
    let uncertain = false;
    let dispatched = false;
    try {
      parseBrokerCommand(command); // Recheck the deadline after reserving a write.
      const url = new URL(command.path, this.origin);
      if (url.origin !== this.origin) throw new Error("Destino invalido");
      for (const [key, value] of Object.entries(command.query ?? {})) {
        for (const item of Array.isArray(value) ? value : [value])
          url.searchParams.append(key, String(item));
      }
      const headers: Record<string, string> = { accept: "application/json" };
      if (command.accessToken)
        headers.authorization = `Bearer ${command.accessToken}`;
      let body: string | FormData | undefined;
      if (command.file) {
        body = new FormData();
        body.append(
          "file",
          new Blob(
            [new Uint8Array(Buffer.from(command.file.base64, "base64"))],
            { type: command.file.contentType },
          ),
          command.file.filename,
        );
      } else if (command.body !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(command.body);
      }
      dispatched = true;
      const response = await this.send(url, {
        method: command.method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(
          Math.max(
            1,
            Math.min(
              this.timeoutMs,
              Date.parse(command.expiresAt) - Date.now(),
            ),
          ),
        ),
      });
      const auditId = response.headers.get("x-request-id");
      const auditRequestId =
        auditId && AUDIT_UUID.test(auditId) ? auditId : undefined;
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      if (reader) {
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          bytes += item.value.length;
          if (bytes > RPC_MESSAGE_BYTES) {
            await reader.cancel();
            throw new InvalidBrokerCommand(
              413,
              "Respuesta RPC demasiado grande; reduce la paginacion",
            );
          }
          chunks.push(item.value);
        }
      }
      const text = Buffer.concat(chunks).toString("utf8");
      let data: unknown = text || null;
      if (
        text &&
        response.headers.get("content-type")?.includes("application/json")
      )
        data = JSON.parse(text);
      // Redirects are returned as errors, never followed to another origin.
      result = reply(
        response.status >= 300 && response.status < 400 ? 502 : response.status,
        data,
        auditRequestId,
      );
    } catch (error) {
      uncertain = mutation && dispatched;
      result = reply(
        error instanceof InvalidBrokerCommand ? error.statusCode : 504,
        {
          message:
            error instanceof InvalidBrokerCommand
              ? error.message
              : "No se pudo confirmar la respuesta del controlador; no repitas una escritura con otro requestId sin verificar su resultado.",
        },
      );
    }
    if (mutation) {
      try {
        await this.pool.query(
          `UPDATE broker_commands SET state = $3, status_code = $4, audit_request_id = $5, finished_at = now()
          WHERE service = $1 AND request_id = $2`,
          [
            this.service,
            command.requestId,
            uncertain ? "uncertain" : "completed",
            result.statusCode,
            result.auditRequestId ?? null,
          ],
        );
      } catch {
        // The durable reservation still prevents duplicate writes; no tokens or
        // response data are cached. A stale 'started' record means review required.
      }
    }
    return result;
  }
}
