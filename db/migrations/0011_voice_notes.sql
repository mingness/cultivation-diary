CREATE TYPE "public"."audio_mime" AS ENUM('audio/mpeg');--> statement-breakpoint
CREATE TYPE "public"."audio_pending" AS ENUM('add', 'remove');--> statement-breakpoint
ALTER TYPE "public"."usage_kind" ADD VALUE 'audio';--> statement-breakpoint
CREATE TABLE "document_audio" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"audio_ct" "bytea" NOT NULL,
	"audio_nonce" "bytea" NOT NULL,
	"mime" "audio_mime" NOT NULL,
	"duration_ms" integer NOT NULL,
	"bytes" integer NOT NULL,
	"pending" "audio_pending",
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "document_audio_duration_range" CHECK ("document_audio"."duration_ms" BETWEEN 1 AND 120000)
);
--> statement-breakpoint
ALTER TABLE "document_audio" ADD CONSTRAINT "document_audio_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_audio_document_idx" ON "document_audio" USING btree ("document_id","created_at");