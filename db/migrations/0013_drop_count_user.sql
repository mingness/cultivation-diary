-- The mantra site became its own app (2026-11-16): the diary has no self-registration, and so no COUNT_USER
-- (mantra-only) accounts. Any left are deleted with their counts (count_entries cascade; activity and alerts
-- keep their usernames), then the role leaves the enum. The delete runs once the column is text: a fresh
-- database adds 'COUNT_USER' (0010) in the same transaction, and Postgres refuses to use a new enum value there.
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
DELETE FROM "users" WHERE "role" = 'COUNT_USER';--> statement-breakpoint
DROP TYPE "public"."role";--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('NORMAL_USER', 'COURSE_LEADER', 'SYS_ADMIN');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."role" USING "role"::"public"."role";
