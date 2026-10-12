import re
import xml.etree.ElementTree as ET
from typing import Any, cast
from urllib.parse import urlparse

import httpx

from app.tools.budget import ToolBudget, ToolBudgetExceeded


class ArxivPaperTool:
    name = "arxiv_paper_search"
    version = "arxiv-paper-v1"

    def __init__(self, enabled: bool = False) -> None:
        self.enabled = enabled

    async def search(
        self,
        concept_names: list[str],
        limit: int,
        budget: ToolBudget,
        paper_strategy: str = "current",
    ) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        try:
            budget.consume(self.name, optional=True)
            terms = [
                re.sub(r"\s+", " ", re.sub(r"[^\w .-]", " ", name)).strip()
                for name in concept_names[:8]
            ]
            concept_query = " OR ".join(f'all:"{term}"' for term in terms if term)
            if not concept_query:
                return []
            search_query = f"({concept_query})"
            if paper_strategy == "foundational":
                search_query += (
                    ' AND (all:"foundational" OR all:"seminal" OR all:"landmark" OR '
                    'all:"original work" OR all:"canonical paper" OR '
                    'all:"influential work" OR all:"first work" OR all:"early defining" OR '
                    'all:"pioneering" OR all:"introduced")'
                )
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(
                    "https://export.arxiv.org/api/query",
                    params={
                        "search_query": search_query,
                        "start": 0,
                        "max_results": min(10, max(1, limit)),
                        "sortBy": "submittedDate" if paper_strategy == "current" else "relevance",
                        "sortOrder": "descending",
                    },
                )
                response.raise_for_status()
                content = response.text
        except ToolBudgetExceeded:
            raise
        except Exception:
            return []
        results = parse_arxiv_results(content, limit)
        return [{**item, "retrieval_strategy": paper_strategy} for item in results]


def parse_arxiv_results(content: object, limit: int) -> list[dict[str, Any]]:
    if isinstance(content, list):
        raw_items = cast(list[object], content)
        structured: list[dict[str, object]] = [
            cast(dict[str, object], item) for item in raw_items if isinstance(item, dict)
        ]
        parsed = [_structured_result(item) for item in structured]
        return [item for item in parsed if item is not None][:limit]
    if isinstance(content, dict):
        body = cast(dict[str, object], content)
        return parse_arxiv_results(body.get("results", []), limit)
    text = content if isinstance(content, str) else str(content)
    if text.lstrip().startswith("<"):
        try:
            feed = ET.fromstring(text)
        except ET.ParseError:
            return []
        namespace = "{http://www.w3.org/2005/Atom}"
        entries: list[dict[str, object]] = []
        for entry in feed.findall(f"{namespace}entry")[:limit]:
            paper_id = entry.findtext(f"{namespace}id", "")
            identifier = urlparse(paper_id).path.removeprefix("/abs/")
            entries.append(
                {
                    "arxiv_id": identifier,
                    "title": entry.findtext(f"{namespace}title", "").strip(),
                    "summary": entry.findtext(f"{namespace}summary", "").strip(),
                    "authors": [
                        author.findtext(f"{namespace}name", "").strip()
                        for author in entry.findall(f"{namespace}author")
                    ],
                    "categories": [
                        category.get("term", "")
                        for category in entry.findall(f"{namespace}category")
                    ],
                    "published_at": entry.findtext(f"{namespace}published"),
                }
            )
        return parse_arxiv_results(entries, limit)
    matches = re.finditer(
        r"Title:\s*(?P<title>[^\n]+).*?https://arxiv.org/(?:abs|pdf)/(?P<id>[\w.\-]+)",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    return [
        {
            "url": f"https://arxiv.org/abs/{match.group('id').removesuffix('.pdf')}",
            "title": match.group("title").strip(),
            "text": text[max(0, match.start()) : match.end()][:800],
        }
        for match in list(matches)[:limit]
    ]


def _structured_result(item: dict[str, object]) -> dict[str, Any] | None:
    raw_id = item.get("arxiv_id") or item.get("arxivId")
    raw_url = item.get("url") or item.get("canonical_url")
    arxiv_id = str(raw_id).strip() if isinstance(raw_id, str) else ""
    if not arxiv_id and isinstance(raw_url, str):
        parsed = urlparse(raw_url)
        if parsed.hostname == "arxiv.org":
            arxiv_id = (
                parsed.path.removeprefix("/abs/")
                .removeprefix("/pdf/")
                .removesuffix(".pdf")
            )
    title = item.get("title")
    if not arxiv_id or not isinstance(title, str) or len(title.strip()) < 3:
        return None
    text = item.get("abstract") or item.get("summary") or item.get("text")
    return {
        "url": f"https://arxiv.org/abs/{arxiv_id}",
        "title": title.strip(),
        "text": text[:800] if isinstance(text, str) else None,
        "authors": item.get("authors", []),
        "categories": item.get("categories", []),
        "publishedDate": item.get("published_at") or item.get("publishedAt"),
    }
