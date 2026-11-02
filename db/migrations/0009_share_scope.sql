-- The check compares "access" with an enum literal, so it can't survive the type swap; it comes back below.
ALTER TABLE "documents" DROP CONSTRAINT "documents_only_submitted_shared";--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "access" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "access" SET DEFAULT 'private'::text;--> statement-breakpoint
-- Leaders no longer approve sharing; the author decides (agreed 2026-10-19). An open entry and one whose
-- author asked to share it both become shared with the author's class.
UPDATE "documents" SET "access" = 'course' WHERE "access" IN ('open', 'wait_for_open');--> statement-breakpoint
DROP TYPE "public"."access";--> statement-breakpoint
CREATE TYPE "public"."access" AS ENUM('private', 'course', 'everyone');--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "access" SET DEFAULT 'private'::"public"."access";--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "access" SET DATA TYPE "public"."access" USING "access"::"public"."access";--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_only_submitted_shared" CHECK ("documents"."access" = 'private' OR "documents"."first_submitted_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "unshared_by_leader_at" timestamp with time zone;
