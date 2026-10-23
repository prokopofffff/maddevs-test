CREATE TABLE "participant_sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_verifications" ALTER COLUMN "event_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "email_verifications_login_idx" ON "email_verifications" USING btree ("email","created_at" DESC NULLS LAST) WHERE "email_verifications"."purpose" = 'login';--> statement-breakpoint
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_event_check" CHECK (("email_verifications"."purpose" = 'login') = ("email_verifications"."event_id" is null));