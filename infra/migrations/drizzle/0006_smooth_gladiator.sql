ALTER TABLE "retrieval"."ingestion_runs" DROP CONSTRAINT "ingestion_runs_resource_version_fkey";
--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_concepts" DROP CONSTRAINT "artifact_concepts_concept_id_concepts_id_fk";
--> statement-breakpoint
ALTER TABLE "retrieval"."ingestion_runs" ADD CONSTRAINT "ingestion_runs_resource_version_fkey" FOREIGN KEY ("resource_id","resource_version_id") REFERENCES "catalog"."resource_versions"("resource_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_concepts" ADD CONSTRAINT "artifact_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE restrict ON UPDATE no action;