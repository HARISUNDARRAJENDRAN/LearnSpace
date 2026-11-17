-- One person is one author. The catalog used to create an author per paper when no ORCID or Semantic Scholar ID matched,
-- so a name could have many rows. Each name's unidentified rows merge into its earliest row (identified rows first), and
-- names without a letter, which are parse debris, stop being authors.
CREATE TEMP TABLE author_merge ON COMMIT DROP AS
SELECT duplicate.id AS duplicate_id, keeper.id AS keep_id
FROM catalog.authors duplicate
JOIN LATERAL (
  SELECT candidate.id FROM catalog.authors candidate
  WHERE candidate.normalized_name = duplicate.normalized_name
  ORDER BY (candidate.orcid IS NULL), (candidate.semantic_scholar_id IS NULL), candidate.created_at, candidate.id
  LIMIT 1
) keeper ON keeper.id <> duplicate.id
WHERE duplicate.normalized_name <> '' AND duplicate.orcid IS NULL AND duplicate.semantic_scholar_id IS NULL;--> statement-breakpoint
-- A paper that lists one person under two rows keeps the first listing.
DELETE FROM catalog.paper_authors listing
USING catalog.paper_authors earlier
LEFT JOIN author_merge earlier_merge ON earlier_merge.duplicate_id = earlier.author_id
WHERE earlier.paper_resource_id = listing.paper_resource_id AND earlier.ordinal < listing.ordinal
  AND COALESCE(earlier_merge.keep_id, earlier.author_id) = COALESCE((SELECT keep_id FROM author_merge WHERE duplicate_id = listing.author_id), listing.author_id);--> statement-breakpoint
UPDATE catalog.paper_authors listing SET author_id = merge.keep_id FROM author_merge merge WHERE listing.author_id = merge.duplicate_id;--> statement-breakpoint
INSERT INTO discovery.favorite_authors (user_id, author_id, followed_at)
SELECT follow.user_id, merge.keep_id, min(follow.followed_at)
FROM discovery.favorite_authors follow JOIN author_merge merge ON merge.duplicate_id = follow.author_id
GROUP BY follow.user_id, merge.keep_id
ON CONFLICT (user_id, author_id) DO UPDATE SET followed_at = LEAST(discovery.favorite_authors.followed_at, EXCLUDED.followed_at);--> statement-breakpoint
DELETE FROM catalog.authors WHERE id IN (SELECT duplicate_id FROM author_merge);--> statement-breakpoint
DELETE FROM catalog.paper_authors WHERE author_id IN (SELECT id FROM catalog.authors WHERE preferred_name ~ '^[[:space:][:punct:][:digit:]]*$');--> statement-breakpoint
DELETE FROM catalog.authors WHERE preferred_name ~ '^[[:space:][:punct:][:digit:]]*$';
