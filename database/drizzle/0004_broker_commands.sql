CREATE TABLE "broker_commands" (
  "service" varchar(30) NOT NULL,
  "request_id" uuid NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "state" varchar(20) DEFAULT 'started' NOT NULL,
  "status_code" integer,
  "audit_request_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "finished_at" timestamptz,
  CONSTRAINT "broker_commands_service_request_id_pk" PRIMARY KEY ("service", "request_id")
);
