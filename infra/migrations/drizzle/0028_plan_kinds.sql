UPDATE "study"."schedule_items" AS item SET "kind" = CASE
  WHEN resource."type" = 'video' THEN 'watch'
  WHEN resource."type" = 'code' THEN 'practice'
  WHEN resource."type" IS NOT NULL THEN 'read'
  ELSE 'practice'
END
FROM "study"."schedule_items" AS base
LEFT JOIN "catalog"."resources" AS resource ON resource."id" = base."resource_id"
WHERE base."id" = item."id";--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD CONSTRAINT "schedule_items_kind_chk" CHECK ("study"."schedule_items"."kind" IN ('watch', 'read', 'practice', 'review'));
