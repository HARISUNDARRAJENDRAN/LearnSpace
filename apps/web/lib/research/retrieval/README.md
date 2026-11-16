# Research retrieval

`retrieveResearchPapers(query, options?)` is the single search entry point used by source discovery and the tutor. It calls Exa's interactive paper search once and maps the returned arXiv records into the shared paper shape.

`understandResearchQuery` classifies exact titles, identifiers, author searches, topics, foundational and recent searches, comparisons, and prerequisite requests. The Exa query uses normalized arXiv or DOI identifiers, scopes author searches, and frames prerequisite searches as foundational reading. Foundational and recent intents are also passed to Exa's ranking lane. Exa order is preserved, with an exact arXiv identifier moved to the front when it appears.

Repeated arXiv IDs, equivalent arXiv DOI identities, and normalized duplicate titles are removed while preserving the first result. A failed Exa request is returned in `partialFailures`; a missing `EXA_API_KEY` makes no request and returns an actionable configuration error. The timeout defaults to four seconds and can be overridden in `RetrievalOptions`.
