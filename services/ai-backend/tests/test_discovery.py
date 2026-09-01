import asyncio
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.cache.discovery_cache import DiscoveryCache, arxiv_cache_key, youtube_cache_key
from app.config import Settings
from app.contracts.discovery import (
    ArxivCandidate,
    DiscoveryRefreshRequest,
    YoutubeCandidate,
)
from app.flows.discovery_refresh import DiscoveryRefreshFlow
from app.guardrails.candidate_validation import (
    validate_arxiv_candidate,
    validate_youtube_candidate,
)
from app.tools.budget import ToolBudget, ToolBudgetExceeded

CONCEPT_ID = UUID("00000000-0000-0000-0000-000000000001")
SECOND_CONCEPT_ID = UUID("00000000-0000-0000-0000-000000000002")


def youtube_candidate(concept_id: UUID = CONCEPT_ID) -> YoutubeCandidate:
    return YoutubeCandidate(
        youtube_id="dQw4w9WgXcQ",
        canonical_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title="A practical lesson",
        matched_concept_ids=[concept_id],
        confidence=0.8,
    )


def arxiv_candidate(
    concept_id: UUID = CONCEPT_ID,
    paper_class: Literal["current", "foundational"] = "current",
    arxiv_id: str = "1706.03762",
) -> ArxivCandidate:
    return ArxivCandidate(
        arxiv_id=arxiv_id,
        canonical_url=f"https://arxiv.org/abs/{arxiv_id}",
        title="Attention Is All You Need",
        matched_concept_ids=[concept_id],
        paper_class=paper_class,
        confidence=0.8,
    )


def request() -> DiscoveryRefreshRequest:
    return DiscoveryRefreshRequest(
        concept_ids=[CONCEPT_ID],
        concept_names=["Artificial Intelligence"],
        level="beginner",
        trace_id="test-trace",
    )


def test_external_candidates_are_domain_validated() -> None:
    assert validate_youtube_candidate(youtube_candidate()) is not None
    assert validate_arxiv_candidate(arxiv_candidate()) is not None
    assert (
        validate_youtube_candidate(
            youtube_candidate().model_copy(update={"canonical_url": "https://example.com/video"})
        )
        is None
    )
    assert (
        validate_youtube_candidate(
            youtube_candidate().model_copy(
                update={"canonical_url": "https://evil-youtube.com/watch?v=dQw4w9WgXcQ"}
            )
        )
        is None
    )
    assert (
        validate_arxiv_candidate(
            arxiv_candidate().model_copy(update={"canonical_url": "https://example.com/paper"})
        )
        is None
    )


def test_refresh_request_rejects_unbounded_input() -> None:
    with pytest.raises(ValidationError):
        DiscoveryRefreshRequest.model_validate(
            {"concept_ids": [CONCEPT_ID], "concept_names": ["AI"], "unexpected": "private notes"}
        )


def test_cache_keys_are_versioned_and_do_not_contain_pii() -> None:
    youtube_key = youtube_cache_key(str(CONCEPT_ID), "beginner", "any", 30)
    arxiv_key = arxiv_cache_key(str(CONCEPT_ID), "beginner", 30)
    assert str(CONCEPT_ID) in youtube_key
    assert "email" not in youtube_key
    assert arxiv_key.endswith("discovery-tools-v1")
    assert "current" in arxiv_key


def test_flow_caches_validated_candidates_and_skips_fresh_pools() -> None:
    class FakeYoutube:
        calls = 0

        async def discover(
            self, request: DiscoveryRefreshRequest, budget: ToolBudget
        ) -> list[YoutubeCandidate]:
            del request
            del budget
            self.calls += 1
            return [youtube_candidate()]

    class FakeArxiv:
        calls = 0

        async def discover(
            self, request: DiscoveryRefreshRequest, budget: ToolBudget
        ) -> list[ArxivCandidate]:
            del budget
            self.calls += 1
            return [
                arxiv_candidate(
                    paper_class=request.paper_strategy,
                    arxiv_id="1706.03762" if request.paper_strategy == "current" else "1810.04805",
                )
            ]

    async def run() -> None:
        cache = DiscoveryCache()
        youtube = FakeYoutube()
        arxiv = FakeArxiv()
        flow = DiscoveryRefreshFlow(cache, youtube, arxiv)
        first = await flow.run_discovery(request())
        assert len(first.youtube) == 1
        assert len(first.arxiv) == 2
        assert youtube.calls == 1
        assert arxiv.calls == 2

        await cache.set(
            youtube_cache_key(str(CONCEPT_ID), "beginner", "any", 30),
            [youtube_candidate().model_dump(mode="json") for _ in range(6)],
        )
        await cache.set(
            arxiv_cache_key(str(CONCEPT_ID), "beginner", 30),
            [arxiv_candidate(arxiv_id="1706.03762").model_dump(mode="json") for _ in range(2)],
        )
        await cache.set(
            arxiv_cache_key(str(CONCEPT_ID), "beginner", 365, "foundational"),
            [
                arxiv_candidate(paper_class="foundational", arxiv_id="1810.04805").model_dump(
                    mode="json"
                )
                for _ in range(2)
            ],
        )
        second = await flow.run_discovery(request())
        assert second.cache_hit
        assert second.skipped == ["video", "paper"]
        assert youtube.calls == 1
        assert arxiv.calls == 2
        assert second.generated_at <= datetime.now(UTC)

    asyncio.run(run())


def test_flow_isolates_each_concept_pool_and_paper_class() -> None:
    class FakeYoutube:
        calls: list[UUID] = []

        async def discover(
            self, request: DiscoveryRefreshRequest, budget: ToolBudget
        ) -> list[YoutubeCandidate]:
            del budget
            self.calls.append(request.concept_ids[0])
            youtube_id = (
                "dQw4w9WgXcQ"
                if request.concept_ids[0] == CONCEPT_ID
                else "9bZkp7q19f0"
            )
            return [
                youtube_candidate(request.concept_ids[0]).model_copy(
                    update={
                        "youtube_id": youtube_id,
                        "canonical_url": f"https://www.youtube.com/watch?v={youtube_id}",
                    }
                )
            ]

    class FakeArxiv:
        calls: list[tuple[UUID, str]] = []

        async def discover(
            self, request: DiscoveryRefreshRequest, budget: ToolBudget
        ) -> list[ArxivCandidate]:
            del budget
            self.calls.append((request.concept_ids[0], request.paper_strategy))
            suffix = "2" if request.concept_ids[0] == SECOND_CONCEPT_ID else ""
            arxiv_id = (
                ("1706.0376" + suffix)
                if request.paper_strategy == "current"
                else ("1810.0480" + suffix)
            )
            return [arxiv_candidate(request.concept_ids[0], request.paper_strategy, arxiv_id)]

    async def run() -> None:
        cache = DiscoveryCache()
        youtube = FakeYoutube()
        arxiv = FakeArxiv()
        flow = DiscoveryRefreshFlow(cache, youtube, arxiv, max_tool_calls=10)
        result = await flow.run_discovery(
            DiscoveryRefreshRequest(
                concept_ids=[CONCEPT_ID, SECOND_CONCEPT_ID],
                concept_names=["Artificial Intelligence", "Physics"],
            )
        )
        assert {candidate.matched_concept_ids[0] for candidate in result.youtube} == {
            CONCEPT_ID,
            SECOND_CONCEPT_ID,
        }
        assert {candidate.matched_concept_ids[0] for candidate in result.arxiv} == {
            CONCEPT_ID,
            SECOND_CONCEPT_ID,
        }
        assert set(youtube.calls) == {CONCEPT_ID, SECOND_CONCEPT_ID}
        assert set(arxiv.calls) == {
            (CONCEPT_ID, "current"),
            (CONCEPT_ID, "foundational"),
            (SECOND_CONCEPT_ID, "current"),
            (SECOND_CONCEPT_ID, "foundational"),
        }
        first_pool = await cache.get(youtube_cache_key(str(CONCEPT_ID), "mixed", "any", 30))
        second_pool = await cache.get(youtube_cache_key(str(SECOND_CONCEPT_ID), "mixed", "any", 30))
        assert first_pool and first_pool[0]["matched_concept_ids"] == [str(CONCEPT_ID)]
        assert second_pool and second_pool[0]["matched_concept_ids"] == [str(SECOND_CONCEPT_ID)]

    asyncio.run(run())


def test_tool_budget_is_shared_and_enforced() -> None:
    budget = ToolBudget(2)
    budget.consume("exa")
    budget.consume("youtube-content")
    with pytest.raises(ToolBudgetExceeded):
        budget.consume("arxiv")


def test_live_readiness_requires_provider_dependencies() -> None:
    settings = Settings(
        internal_service_token="token",
        exa_api_key=None,
        agents_enabled=True,
        max_concurrency=1,
        max_tool_calls=2,
        request_timeout_seconds=8,
        redis_url=None,
        database_ai_url=None,
        youtube_embedder_provider="openai",
        youtube_embedder_model="text-embedding-3-small",
    )
    errors = settings.readiness_errors()
    assert "EXA_API_KEY" in errors
    assert "REDIS_URL" not in errors
