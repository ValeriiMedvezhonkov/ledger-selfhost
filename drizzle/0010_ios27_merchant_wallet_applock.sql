CREATE TYPE "public"."transaction_source" AS ENUM('manual', 'apple_pay', 'import', 'recurring');--> statement-breakpoint
CREATE TABLE "wallet_webhook" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"secret_hash" text,
	"secret_hint" text,
	"rotated_at" timestamp with time zone,
	"last_received_at" timestamp with time zone,
	"last_transaction_id" uuid,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_credential" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[],
	"device_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "webauthn_credential_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "app_unlocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "merchant" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "merchant_slug" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "source" "transaction_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "recurring_rule_id" uuid;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "split_group_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "avatar_emoji" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "app_lock_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet_webhook" ADD CONSTRAINT "wallet_webhook_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_webhook" ADD CONSTRAINT "wallet_webhook_last_transaction_id_transaction_id_fk" FOREIGN KEY ("last_transaction_id") REFERENCES "public"."transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credential" ADD CONSTRAINT "webauthn_credential_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webauthn_credential_user_idx" ON "webauthn_credential" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_recurring_rule_id_recurring_rule_id_fk" FOREIGN KEY ("recurring_rule_id") REFERENCES "public"."recurring_rule"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_one_default_per_household" ON "account" USING btree ("household_id") WHERE "account"."is_default";--> statement-breakpoint
CREATE INDEX "transaction_household_merchant_idx" ON "transaction" USING btree ("household_id",lower("merchant"));--> statement-breakpoint
CREATE INDEX "transaction_split_group_idx" ON "transaction" USING btree ("split_group_id");--> statement-breakpoint
-- Backfill (hand-written). Until now `note` was the row's title — "merchant
-- *or* note" (NOTES.md, "The field stays free text") — so every existing value
-- is a title, and moves wholesale. The seeded slug travels with it so seeded
-- rows keep following the interface language.
UPDATE "transaction"
SET "merchant" = "note", "merchant_slug" = "note_slug", "note" = NULL, "note_slug" = NULL
WHERE "note" IS NOT NULL;--> statement-breakpoint
-- One default account per household: the first active one, in the order the
-- accounts screen shows them. Matches what the Wallet webhook picked before.
UPDATE "account" SET "is_default" = true
WHERE "id" IN (
	SELECT DISTINCT ON ("household_id") "id"
	FROM "account"
	WHERE "archived_at" IS NULL
	ORDER BY "household_id", "sort_order", "created_at"
);
