CREATE TABLE "application_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "source" varchar(50) NOT NULL,
  "destination" varchar(10) NOT NULL,
  "payload" jsonb NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamptz DEFAULT now() NOT NULL,
  "locked_until" timestamptz,
  "claimed_by" uuid,
  "published_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "application_outbox_event_destination_idx" ON "application_outbox" ("event_id", "destination");
--> statement-breakpoint
CREATE INDEX "application_outbox_pending_idx" ON "application_outbox" ("source", "published_at", "available_at");
--> statement-breakpoint
CREATE TABLE "audit_event_receipts" (
  "event_id" uuid PRIMARY KEY NOT NULL,
  "event_hash" varchar(64) NOT NULL,
  "received_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE FUNCTION record_application_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  before_row jsonb;
  after_row jsonb;
  target_row jsonb;
  context jsonb;
  event jsonb;
  event_id uuid := gen_random_uuid();
  source_name text;
  changed jsonb;
BEGIN
  -- Internal consumer inserts must not emit another audit event indefinitely.
  -- User-facing CRUD of audit_logs still emits events, including DELETE.
  IF TG_TABLE_NAME = 'audit_logs' AND current_setting('app.audit_ingest', true) = 'true' THEN
    RETURN NULL;
  END IF;
  before_row := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  after_row := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  IF TG_OP = 'UPDATE' AND before_row = after_row THEN RETURN NULL; END IF;
  target_row := CASE WHEN TG_OP = 'DELETE' THEN before_row ELSE after_row END;
  context := COALESCE(NULLIF(current_setting('app.audit_context', true), '')::jsonb, '{}'::jsonb);
  source_name := context->>'source';
  IF source_name IS NULL OR source_name NOT IN ('auth-service', 'roles-service', 'permissions-service', 'resources-service', 'areas-service', 'users-service', 'audit-service') THEN
    source_name := 'database';
  END IF;
  SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb) INTO changed
    FROM jsonb_object_keys(before_row || after_row) AS keys(k)
    WHERE (before_row->k) IS DISTINCT FROM (after_row->k);
  event := jsonb_build_object(
    'eventId', event_id, 'version', 1, 'source', source_name,
    'action', CASE TG_OP WHEN 'INSERT' THEN 'data.created' WHEN 'UPDATE' THEN 'data.updated' ELSE 'data.deleted' END,
    'occurredAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'requestId', context->>'requestId',
    'userId', context->>'userId',
    'areaId', CASE WHEN TG_TABLE_NAME = 'areas' THEN target_row->>'id' ELSE COALESCE(target_row->>'area_id', context->>'areaId') END,
    'entity', TG_TABLE_NAME,
    'entityId', CASE WHEN TG_TABLE_NAME = 'role_permissions' THEN (target_row->>'role_id') || ':' || (target_row->>'permission_id') ELSE target_row->>'id' END,
    -- Field names only: no old/new values, tokens, file contents or signed URLs.
    'metadata', jsonb_build_object('changedFields', changed)
  );
  INSERT INTO application_outbox (event_id, source, destination, payload)
    VALUES (event_id, source_name, 'kafka', event), (event_id, source_name, 'rabbit', event);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['roles', 'permissions', 'role_permissions', 'areas', 'users', 'resources', 'audit_logs', 'user_sessions', 'refresh_tokens'] LOOP
    EXECUTE format('CREATE TRIGGER application_audit_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION record_application_change()', target);
  END LOOP;
END;
$$;
