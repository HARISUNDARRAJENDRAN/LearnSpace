-- Re-ingestion replaces a paper's bibliography: ordinals a new parse no longer finds are removed.
GRANT DELETE ON TABLE catalog.paper_references TO learnspace_worker;--> statement-breakpoint
CREATE POLICY paper_references_worker_delete_policy ON catalog.paper_references FOR DELETE TO learnspace_worker USING (true);
