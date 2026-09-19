from datetime import UTC, datetime
from typing import Any, cast
from urllib.parse import urlparse

from app.contracts.discovery import ArxivCandidate, DiscoveryRefreshRequest
from app.guardrails.candidate_validation import validate_arxiv_candidate
from app.tools.arxiv_search import ArxivPaperTool
from app.tools.budget import ToolBudget, ToolBudgetExceeded
from app.tools.exa_discovery import ExaDiscoveryTool

_FOUNDATIONAL_TERMS = (
    "foundational",
    "seminal",
    "landmark",
    "original work",
    "canonical paper",
    "influential work",
    "first work",
    "early defining",
    "pioneering",
    "introduced",
)


def has_foundational_evidence(title: str, evidence: str) -> bool:
    haystack = f"{title} {evidence}".lower()
    return any(term in haystack for term in _FOUNDATIONAL_TERMS)


class ArxivDiscoveryAgent:
    purpose = "research"
    version = "arxiv-discovery-v1"

    def __init__(self, exa: ExaDiscoveryTool, arxiv: ArxivPaperTool, max_results: int = 10) -> None:
        self.exa = exa
        self.arxiv = arxiv
        self.max_results = max_results

    async def discover(
        self, request: DiscoveryRefreshRequest, budget: ToolBudget
    ) -> list[ArxivCandidate]:
        search_terms = request.concept_names or [request.query_text or ""]
        try:
            raw_results = await self.exa.search(
                search_terms,
                "paper",
                request.window_days,
                self.max_results,
                paper_strategy=request.paper_strategy,
                budget=budget,
            )
        except ToolBudgetExceeded:
            raise
        except Exception:
            raw_results = []
        if len(raw_results) < 3:
            try:
                raw_results.extend(
                    await self.arxiv.search(
                        search_terms,
                        self.max_results - len(raw_results),
                        budget,
                        paper_strategy=request.paper_strategy,
                    )
                )
            except ToolBudgetExceeded:
                pass
        output: list[ArxivCandidate] = []
        seen: set[str] = set()
        now = datetime.now(UTC)
        for item in raw_results:
            url = item.get("url")
            title = item.get("title")
            if (
                not isinstance(url, str)
                or not isinstance(title, str)
                or not url.startswith("https://arxiv.org/abs/")
            ):
                continue
            evidence_text = self._evidence(item)
            if request.paper_strategy == "foundational" and not has_foundational_evidence(
                title, evidence_text
            ):
                continue
            published_at = self._date(item.get("publishedDate"))
            if request.paper_strategy == "current" and published_at is not None:
                age_days = (now - published_at).total_seconds() / 86_400
                if age_days > request.window_days:
                    continue
            arxiv_id = urlparse(url).path.removeprefix("/abs/")
            if not arxiv_id or arxiv_id in seen:
                continue
            seen.add(arxiv_id)
            candidate = ArxivCandidate(
                arxiv_id=arxiv_id,
                canonical_url=f"https://arxiv.org/abs/{arxiv_id}",
                title=title.strip(),
                abstract=(
                    item.get("abstract")
                    if isinstance(item.get("abstract"), str)
                    else evidence_text or None
                ),
                published_at=published_at,
                categories=self._strings(item.get("categories")) or (
                    [str(item["category"])] if isinstance(item.get("category"), str) else []
                ),
                authors=self._strings(item.get("authors")),
                matched_concept_ids=request.concept_ids,
                paper_class=request.paper_strategy,
                evidence=(
                    [evidence_text[:800]]
                    if evidence_text
                    else [title[:800]]
                    if request.paper_strategy == "foundational"
                    else []
                ),
                confidence=0.65,
            )
            valid = validate_arxiv_candidate(candidate)
            if valid is not None:
                output.append(valid)
        return output

    @staticmethod
    def _evidence(item: dict[str, Any]) -> str:
        parts: list[str] = []
        for key in ("text", "abstract", "summary", "highlight"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(value.strip())
        highlights = item.get("highlights")
        if isinstance(highlights, list):
            parts.extend(
                value.strip()
                for value in cast(list[object], highlights)
                if isinstance(value, str) and value.strip()
            )
        return " ".join(parts)[:1600]

    @staticmethod
    def _date(value: Any) -> datetime | None:
        if not isinstance(value, str):
            return None
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)

    @staticmethod
    def _strings(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [
            item.strip()
            for item in cast(list[object], value)
            if isinstance(item, str) and item.strip()
        ][:50]
