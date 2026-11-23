CREATE INDEX "credit_tx_created_idx" ON "credit_transaction" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "generation_created_idx" ON "generation" USING btree ("created_at");