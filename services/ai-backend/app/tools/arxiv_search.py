import asyncio
import re
from typing import Any, cast
from urllib.parse import urlparse

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
        from crewai_tools import ArxivPaperTool

        try:
            budget.consume(self.name, optional=True)
            tool = ArxivPaperTool(download_pdfs=False)
            content = await asyncio.to_thread(
                tool.run,
                search_query=(
                    "seminal foundational landmark canonical original work "
                    if paper_strategy == "foundational"
                    else "recent current research "
                )
                + " ".join(concept_names),
                max_results=min(10, max(1, limit)),
            )
        except ToolBudgetExceeded:
            raise
        except Exception:
            return []
        return [
            {**item, "retrieval_strategy": paper_strategy}
            for item in parse_arxiv_results(content, limit)
        ]


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
