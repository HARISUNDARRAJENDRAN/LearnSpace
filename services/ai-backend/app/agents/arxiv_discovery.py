from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

from app.contracts.discovery import ArxivCandidate, DiscoveryRefreshRequest
from app.guardrails.candidate_validation import validate_arxiv_candidate
from app.tools.arxiv_search import ArxivPaperTool
from app.tools.budget import ToolBudget
from app.tools.exa_discovery import ExaDiscoveryTool


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
        if len(request.concept_ids) != 1 or len(request.concept_names) != 1:
            raise ValueError("arXiv discovery requires one canonical concept pool")
        raw_results = await self.exa.search(
            request.concept_names,
            "paper",
            request.window_days,
            self.max_results,
            paper_strategy=request.paper_strategy,
            budget=budget,
        )
        if len(raw_results) < 3:
            raw_results.extend(
                await self.arxiv.search(
                    request.concept_names, self.max_results - len(raw_results), budget
                )
            )
        output: list[ArxivCandidate] = []
        seen: set[str] = set()
        for item in raw_results:
            url = item.get("url")
            title = item.get("title")
            if (
                not isinstance(url, str)
                or not isinstance(title, str)
                or not url.startswith("https://arxiv.org/abs/")
            ):
                continue
            arxiv_id = urlparse(url).path.removeprefix("/abs/")
            if not arxiv_id or arxiv_id in seen:
                continue
            seen.add(arxiv_id)
            candidate = ArxivCandidate(
                arxiv_id=arxiv_id,
                canonical_url=f"https://arxiv.org/abs/{arxiv_id}",
                title=title.strip(),
                abstract=item.get("text") if isinstance(item.get("text"), str) else None,
                published_at=self._date(item.get("publishedDate")),
                categories=[str(item["category"])] if isinstance(item.get("category"), str) else [],
                matched_concept_ids=[request.concept_ids[0]],
                paper_class=request.paper_strategy,
                evidence=[str(item.get("text"))[:800]] if item.get("text") else [],
                confidence=0.65,
            )
            valid = validate_arxiv_candidate(candidate)
            if valid is not None:
                output.append(valid)
        return output

    @staticmethod
    def _date(value: Any) -> datetime | None:
        if not isinstance(value, str):
            return None
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
