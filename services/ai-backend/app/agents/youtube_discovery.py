from datetime import UTC, datetime
from typing import Any

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
        if len(request.concept_ids) != 1 or len(request.concept_names) != 1:
            raise ValueError("YouTube discovery requires one canonical concept pool")
        raw_results = await self.exa.search(
            request.concept_names, "video", request.window_days, self.max_results, budget=budget
        )
        shortlist_urls = [
            item["url"] for item in raw_results[:5] if isinstance(item.get("url"), str)
        ]
        content_signals = await self.content_search.analyze(shortlist_urls, budget)
        output: list[YoutubeCandidate] = []
        for item in raw_results:
            url = item.get("url")
            title = item.get("title")
            if not isinstance(url, str) or not isinstance(title, str):
                continue
            youtube_id = youtube_id_from_url(url)
            if youtube_id is None:
                continue
            signal = content_signals.get(url, {})
            candidate = YoutubeCandidate(
                youtube_id=youtube_id,
                canonical_url=f"https://www.youtube.com/watch?v={youtube_id}",
                title=title.strip(),
                channel=item.get("author") if isinstance(item.get("author"), str) else None,
                published_at=self._date(item.get("publishedDate")),
                language=item.get("language") if isinstance(item.get("language"), str) else None,
                matched_concept_ids=[request.concept_ids[0]],
                learning_format=signal.get("learningFormat")
                if isinstance(signal.get("learningFormat"), str)
                else None,
                estimated_level=signal.get("estimatedLevel")
                if signal.get("estimatedLevel") in {"beginner", "intermediate", "advanced", "mixed"}
                else None,
                evidence=[str(item.get("text"))[:800]] if item.get("text") else [],
                confidence=0.7 if signal else 0.6,
            )
            valid = validate_youtube_candidate(candidate)
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
