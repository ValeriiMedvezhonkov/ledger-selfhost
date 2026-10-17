ALTER TABLE "account" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "goal" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "household" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "recurring_rule" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "recurring_rule" ADD COLUMN "note_slug" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "note_slug" text;