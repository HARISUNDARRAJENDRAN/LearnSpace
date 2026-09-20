from datetime import UTC, datetime
from typing import Any, cast

from app.contracts.discovery import DiscoveryRefreshRequest, YoutubeCandidate
from app.guardrails.candidate_validation import validate_youtube_candidate, youtube_id_from_url
from app.tools.budget import ToolBudget
from app.tools.exa_discovery import ExaDiscoveryTool
from app.tools.youtube_content_search import YoutubeContentSearchTool


class YoutubeDiscoveryAgent:
    purpose = "recommendation"
    version = "youtube-discovery-v1"

    def __init__(
        self, exa: ExaDiscoveryTool, content_search: YoutubeContentSearchTool, max_results: int = 10
    ) -> None:
        self.exa = exa
        self.content_search = content_search
        self.max_results = max_results

    async def discover(
        self, request: DiscoveryRefreshRequest, budget: ToolBudget
    ) -> list[YoutubeCandidate]:
        return await self._discover(request, budget, interactive=False)

    async def discover_fast(
        self, request: DiscoveryRefreshRequest, budget: ToolBudget, limit: int = 30
    ) -> list[YoutubeCandidate]:
        return await self._discover(request, budget, interactive=True, limit=limit)

    async def _discover(
        self,
        request: DiscoveryRefreshRequest,
        budget: ToolBudget,
        *,
        interactive: bool,
        limit: int = 30,
    ) -> list[YoutubeCandidate]:
        max_results = min(30, max(1, limit)) if interactive else self.max_results
        search_terms = [request.query_text] if request.query_text else request.concept_names
        raw_results = await self.exa.search(
            search_terms,
            "video",
            request.window_days,
            max_results,
            budget=budget,
            interactive=interactive,
            ranking_intent=request.ranking_intent or "best_match",
        )
        output: list[YoutubeCandidate] = []
        for item in raw_results:
            url = item.get("url")
            title = item.get("title")
            if not isinstance(url, str) or not isinstance(title, str):
                continue
            youtube_id = youtube_id_from_url(url)
            if youtube_id is None:
                continue
            raw_evidence = item.get("text")
            if not isinstance(raw_evidence, str):
                highlights = item.get("highlights")
                raw_evidence = (
                    " ".join(
                        value
                        for value in cast(list[object], highlights)
                        if isinstance(value, str)
                    )
                    if isinstance(highlights, list)
                    else ""
                )
            candidate = YoutubeCandidate(
                youtube_id=youtube_id,
                canonical_url=f"https://www.youtube.com/watch?v={youtube_id}",
                title=title.strip(),
                channel=item.get("author") if isinstance(item.get("author"), str) else None,
                published_at=self._date(item.get("publishedDate")),
                language=item.get("language") if isinstance(item.get("language"), str) else None,
                matched_concept_ids=request.concept_ids,
                learning_format=None,
                estimated_level=None,
                has_implementation=None,
                evidence=[raw_evidence[:800]] if raw_evidence else [],
                confidence=0.6,
            )
            valid = validate_youtube_candidate(candidate)
            if valid is not None:
                output.append(valid)
        return output

    async def enrich(
        self,
        request: DiscoveryRefreshRequest,
        candidates: list[YoutubeCandidate],
        budget: ToolBudget,
    ) -> list[YoutubeCandidate]:
        if not candidates:
            return []
        signals = await self.content_search.analyze(
            [candidate.canonical_url for candidate in candidates[:5]],
            request.query_text or (request.concept_names[0] if request.concept_names else ""),
            budget,
        )
        output: list[YoutubeCandidate] = []
        for candidate in candidates:
            signal = signals.get(candidate.canonical_url)
            if signal is None:
                output.append(candidate)
                continue
            if not signal.relevant:
                continue
            enriched = candidate.model_copy(
                update={
                    "learning_format": signal.learning_format,
                    "estimated_level": signal.estimated_level,
                    "has_implementation": signal.has_implementation,
                    "evidence": (candidate.evidence + signal.evidence)[:5],
                    "confidence": round(
                        (candidate.confidence + signal.confidence * signal.concept_coverage) / 2,
                        4,
                    ),
                    "source": "youtube-content",
                }
            )
            valid = validate_youtube_candidate(enriched)
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
