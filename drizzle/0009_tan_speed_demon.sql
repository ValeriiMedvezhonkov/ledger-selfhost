CREATE TABLE "quick_pick" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quick_pick" ADD CONSTRAINT "quick_pick_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_pick" ADD CONSTRAINT "quick_pick_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quick_pick_household_idx" ON "quick_pick" USING btree ("household_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "quick_pick_unique" ON "quick_pick" USING btree ("household_id","category_id");