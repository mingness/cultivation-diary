ALTER TABLE "documents" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "documents_pinned_idx" ON "documents" USING btree ("owner_id") WHERE "documents"."pinned_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_only_shared_pinned" CHECK ("documents"."pinned_at" IS NULL OR "documents"."access" <> 'private');