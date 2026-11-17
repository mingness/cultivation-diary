-- What is recited (D40, spec §7.5): a leader picks the recitation from a list kept in the code (RECITATIONS in
-- shared/src/count.ts, named in every language in the web app's string tables), an optional goal, and whether
-- counting starts again. Rows apply by count date and are never deleted. The first row covers everything so
-- far: the Great Compassion Mantra toward 10,000,000, from a date before any count, so every past and
-- backdated date has a recitation. The daily cap rises from 1080 to 5000 (a misuse guard; a name may be
-- recited thousands of times a day).
CREATE TABLE "count_recitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"starts_on" date NOT NULL,
	"recitation" text NOT NULL,
	"goal" integer,
	"restart" boolean NOT NULL,
	"set_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "count_recitations_goal_positive" CHECK ("count_recitations"."goal" IS NULL OR "count_recitations"."goal" > 0)
);
--> statement-breakpoint
ALTER TABLE "count_entries" DROP CONSTRAINT "count_entries_daily_count_range";--> statement-breakpoint
ALTER TABLE "count_settings" DROP CONSTRAINT "count_settings_saved_count_range";--> statement-breakpoint
ALTER TABLE "count_settings" ADD COLUMN "auto_stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "count_recitations" ADD CONSTRAINT "count_recitations_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "count_recitations_starts_on_key" ON "count_recitations" USING btree ("starts_on");--> statement-breakpoint
ALTER TABLE "count_entries" ADD CONSTRAINT "count_entries_daily_count_range" CHECK ("count_entries"."daily_count" BETWEEN 1 AND 5000);--> statement-breakpoint
ALTER TABLE "count_settings" ADD CONSTRAINT "count_settings_saved_count_range" CHECK ("count_settings"."saved_count" BETWEEN 0 AND 5000);--> statement-breakpoint
INSERT INTO "count_recitations" ("id", "starts_on", "recitation", "goal", "restart", "set_by", "created_at", "updated_at")
VALUES (gen_random_uuid(), '2000-01-01', 'great_compassion_mantra', 10000000, true, NULL, now(), now());
