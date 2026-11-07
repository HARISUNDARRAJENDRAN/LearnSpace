ALTER TABLE "study"."schedule_items" ADD COLUMN "resource_id" uuid;--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD COLUMN "source" text DEFAULT 'learner' NOT NULL;--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD COLUMN "progress_pct" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD COLUMN "observer_note" text;--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD COLUMN "evaluated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD CONSTRAINT "schedule_items_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD CONSTRAINT "schedule_items_status_chk" CHECK ("study"."schedule_items"."status" IN ('suggested', 'planned', 'done', 'dismissed'));--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD CONSTRAINT "schedule_items_source_chk" CHECK ("study"."schedule_items"."source" IN ('learner', 'agent'));--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD CONSTRAINT "schedule_items_progress_chk" CHECK ("study"."schedule_items"."progress_pct" BETWEEN 0 AND 100);