CREATE TABLE "admin_log" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_email" text NOT NULL,
	"action" text NOT NULL,
	"target_user_id" text,
	"target_email" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "credit_tx_user_idx";--> statement-breakpoint
DROP INDEX "generation_user_idx";--> statement-breakpoint
DROP INDEX "order_user_idx";--> statement-breakpoint
DROP INDEX "payment_user_idx";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "admin_log_target_idx" ON "admin_log" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_log_created_idx" ON "admin_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "user_created_idx" ON "user" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "credit_tx_user_idx" ON "credit_transaction" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_user_idx" ON "generation" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "order_user_idx" ON "order" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_user_idx" ON "payment" USING btree ("user_id","created_at");