CREATE TABLE "correction_requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "correction_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"registration_id" bigint NOT NULL,
	"old_first_name" text NOT NULL,
	"old_last_name" text NOT NULL,
	"old_birth_date" date NOT NULL,
	"new_first_name" text NOT NULL,
	"new_last_name" text NOT NULL,
	"new_birth_date" date NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" bigint
);
--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "correction_requests_pending_key" ON "correction_requests" USING btree ("registration_id") WHERE "correction_requests"."status" = 'pending';