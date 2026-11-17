ALTER TABLE "catalog"."collection_sections" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
GRANT DELETE ON TABLE catalog.paper_authors, catalog.collection_items TO learnspace_worker;
