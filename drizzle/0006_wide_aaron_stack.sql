CREATE TABLE "refresh_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"family" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"totp_verified" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_token_user_idx" ON "refresh_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_token_family_idx" ON "refresh_token" USING btree ("family");