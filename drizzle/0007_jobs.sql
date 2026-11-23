CREATE TABLE "job" (
	"name" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"schedule" text,
	"locked_until" timestamp with time zone,
	"locked_by" text,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_run" (
	"id" text PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"trigger" text NOT NULL,
	"triggered_by" text,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"summary" text,
	"error" text,
	"log" text
);
--> statement-breakpoint
CREATE TABLE "ledger_issue" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"user_id" text,
	"entity_id" text,
	"detail" text,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	CONSTRAINT "ledger_issue_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE INDEX "job_run_job_idx" ON "job_run" USING btree ("job","started_at");--> statement-breakpoint
CREATE INDEX "job_run_started_idx" ON "job_run" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ledger_issue_status_idx" ON "ledger_issue" USING btree ("status","last_seen_at");