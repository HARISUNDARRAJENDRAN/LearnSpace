# Paper content contract (v1)

This is the single shape every Research-mode feature reads: the reader, focus mode, tutor, notes, Luny voice, exercises and
recommendations. Ingestion writes it; nothing else invents paper structure. It reuses existing tables, and no paper-specific
copies of them are allowed.

## Identity and versions

- `catalog.resources` (type `paper`) plus `catalog.paper_details` hold the canonical paper (arXiv id or DOI unique, real abstract,
  venue, publication date, `pdf_source_url`).
- `catalog.authors` / `catalog.paper_authors` hold authors in order. An author row carries `orcid`, `semantic_scholar_id` and
  `metadata.openalexId` when known. Same-name authors are never merged without a matching identifier.
- `catalog.resource_versions` gets one row per distinct PDF byte hash (`source_sha256`):
  - `parser_name = 'pdf-inspector-researchpapers'`
  - `parser_version = '<fork sha>/<fast|standard>'`
  - `processing_status`: `pending → processing → ready | failed`, with `failure_code` / `failure_detail`
  - `resources.current_version_id` points at the ready version. An unchanged hash is never re-parsed or re-embedded.

## Passages (`retrieval.resource_chunks` for a paper version)

| column | meaning |
|---|---|
| `ordinal` | reading order, 0-based, gap-free |
| `chunk_type` | `heading`, `paragraph`, `equation`, `figure`, `table`, `code` |
| `heading_path` | section hierarchy, e.g. `{"3 Model Architecture","3.2 Attention"}` |
| `page_from` / `page_to` | 1-based PDF pages |
| `paragraph_from` / `paragraph_to` | paragraph index within the page when known |
| `anchor` | `{ "kind": "paper", "page": 4, "sectionId": "3-2-attention", "bbox"?: [x0,y0,x1,y1] }`; bbox is in PDF points, origin top-left, only when the parser supplies it |
| `content` | plain text (markdown inline allowed); equations keep their source text |
| `metadata` | `{ "citations"?: number[] /* bibliography ordinals cited in this passage */, "label"?: "Figure 3" \| "Table 2" \| "Eq. (4)", "caption"?: string, "latex"?: string, "unrecovered"?: string /* what the parser could not recover */ }` |

- `sectionId` is the slug of the full heading path. It is stable across re-ingestion of the same version.
- `heading` chunks exist for every section, so the table of contents is the ordered list of heading chunks.
- `paragraph` chunks are embedded in `retrieval.chunk_embeddings` with the same embedding profile as transcripts. Other types are
  embedded when they have caption or text content.

## References (`catalog.paper_references`)

- `ordinal` is the 1-based bibliography index, matching `metadata.citations` on passages.
- `raw_reference` holds the exact bibliography text. `cited_doi` / `cited_arxiv_id` / `cited_resource_id` are set only when
  verified against a scholarly source. `resolution_status` is `unresolved | resolved | ambiguous`, plus `confidence`.
- `metadata`: `{ "title", "authors", "year", "venue", "url", "source": "openalex" | "semantic_scholar" | "arxiv" | "crossref", "abstract"? }`.
  This is verified metadata only, never LLM-generated.

## Reading position

- `studyAnchorSchema` `{ kind: "paper", page?, sectionId? }` is used for progress, checkpoints, tutor turns and notes.
- Tutor and notes citations point at `{ kind: "paper", page, sectionId, chunkId }`. The UI scrolls the reader there and highlights
  the bbox when one is present.

## PDF bytes

- They are never stored whole in the database. `GET /api/v1/papers/:resourceId/pdf` streams the verified source PDF (allow-listed
  hosts only, with size limits and authentication) so pdf.js can render it; it is cached by the browser and CDN.
