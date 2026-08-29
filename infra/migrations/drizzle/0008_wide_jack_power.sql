ALTER TABLE "retrieval"."chunk_concepts" DROP CONSTRAINT "chunk_concepts_chunk_id_resource_chunks_id_fk";
--> statement-breakpoint
ALTER TABLE "retrieval"."chunk_concepts" DROP CONSTRAINT "chunk_concepts_concept_id_concepts_id_fk";
--> statement-breakpoint
ALTER TABLE "retrieval"."chunk_embeddings" DROP CONSTRAINT "chunk_embeddings_chunk_id_resource_chunks_id_fk";
ALTER TABLE "retrieval"."resource_chunks" DROP CONSTRAINT IF EXISTS "resource_chunks_parent_version_fkey";
--> statement-breakpoint
ALTER TABLE "retrieval"."chunk_concepts" ADD CONSTRAINT "chunk_concepts_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."chunk_concepts" ADD CONSTRAINT "chunk_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."resource_chunks" ADD CONSTRAINT "resource_chunks_parent_version_fkey" FOREIGN KEY ("resource_version_id","parent_chunk_id") REFERENCES "retrieval"."resource_chunks"("resource_version_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."chunk_embeddings" ADD CONSTRAINT "chunk_embeddings_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE restrict ON UPDATE no action;
