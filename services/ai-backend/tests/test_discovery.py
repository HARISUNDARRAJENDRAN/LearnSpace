import asyncio
from datetime import UTC, datetime
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.cache.discovery_cache import DiscoveryCache, arxiv_cache_key, youtube_cache_key
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

CONCEPT_ID = UUID("00000000-0000-0000-0000-000000000001")


def youtube_candidate() -> YoutubeCandidate:
    return YoutubeCandidate(
        youtube_id="dQw4w9WgXcQ",
        canonical_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title="A practical lesson",
        matched_concept_ids=[CONCEPT_ID],
        confidence=0.8,
    )


def arxiv_candidate() -> ArxivCandidate:
    return ArxivCandidate(
        arxiv_id="1706.03762",
        canonical_url="https://arxiv.org/abs/1706.03762",
        title="Attention Is All You Need",
        matched_concept_ids=[CONCEPT_ID],
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


def test_flow_caches_validated_candidates_and_skips_fresh_pools() -> None:
    class FakeYoutube:
        calls = 0

        async def discover(self, request: DiscoveryRefreshRequest) -> list[YoutubeCandidate]:
            del request
            self.calls += 1
            return [youtube_candidate()]

    class FakeArxiv:
        calls = 0

        async def discover(self, request: DiscoveryRefreshRequest) -> list[ArxivCandidate]:
            del request
            self.calls += 1
            return [arxiv_candidate()]

    async def run() -> None:
        cache = DiscoveryCache()
        youtube = FakeYoutube()
        arxiv = FakeArxiv()
        flow = DiscoveryRefreshFlow(cache, youtube, arxiv)
        first = await flow.run_discovery(request())
        assert len(first.youtube) == 1
        assert len(first.arxiv) == 1
        assert youtube.calls == 1
        assert arxiv.calls == 1

        await cache.set(
            youtube_cache_key(str(CONCEPT_ID), "beginner", "any", 30),
            [youtube_candidate().model_dump(mode="json") for _ in range(6)],
        )
        await cache.set(
            arxiv_cache_key(str(CONCEPT_ID), "beginner", 30),
            [arxiv_candidate().model_dump(mode="json") for _ in range(4)],
        )
        second = await flow.run_discovery(request())
        assert second.cache_hit
        assert second.skipped == ["video", "paper"]
        assert youtube.calls == 1
        assert arxiv.calls == 1
        assert second.generated_at <= datetime.now(UTC)

    asyncio.run(run())
