CREATE TABLE "payment_event" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"message" text,
	"user_id" text,
	"user_email" text,
	"order_id" text,
	"plan_id" text,
	"payment_id" text,
	"provider_payment_id" text,
	"provider_order_id" text,
	"provider_sub_id" text,
	"provider_refund_id" text,
	"provider_event_type" text,
	"provider_event_id" text,
	"currency" text,
	"list_amount" integer,
	"discount_amount" integer,
	"charged_amount" integer,
	"refunded_amount" integer,
	"promo_code" text,
	"credits_delta" integer,
	"balance_after" integer,
	"raw" text
);
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "list_amount" integer;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "promo_code" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "order_id" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "user_email" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "list_amount" integer;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "discount_amount" integer;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "promo_code" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "trial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "credits_granted" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "refunded_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "status" text DEFAULT 'paid' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "payment_event_created_idx" ON "payment_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "payment_event_user_idx" ON "payment_event" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_event_order_idx" ON "payment_event" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_event_provider_payment_idx" ON "payment_event" USING btree ("provider_payment_id");