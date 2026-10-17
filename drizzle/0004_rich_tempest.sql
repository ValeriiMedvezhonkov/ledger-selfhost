CREATE TABLE "auth_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"user_id" text,
	"stage" text NOT NULL,
	"outcome" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "totp_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "totp_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "totp_last_step" integer;--> statement-breakpoint
ALTER TABLE "auth_attempt" ADD CONSTRAINT "auth_attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_code" ADD CONSTRAINT "backup_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_attempt_created_idx" ON "auth_attempt" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "auth_attempt_email_idx" ON "auth_attempt" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "auth_attempt_ip_idx" ON "auth_attempt" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "backup_code_user_idx" ON "backup_code" USING btree ("user_id");