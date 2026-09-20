import asyncio
from datetime import UTC, datetime
from typing import Literal, cast
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.agents.arxiv_discovery import ArxivDiscoveryAgent, has_foundational_evidence
from app.agents.youtube_discovery import YoutubeDiscoveryAgent
from app.cache.discovery_cache import (
    DiscoveryCache,
    arxiv_cache_key,
    instant_cache_key,
    query_cache_identity,
    youtube_cache_key,
)
from app.config import Settings
from app.contracts.discovery import (
    ArxivCandidate,
    DiscoveryRefreshRequest,
    InstantDiscoveryRequest,
    YoutubeCandidate,
    YoutubeEnrichment,
)
from app.flows.discovery_refresh import DiscoveryRefreshFlow
from app.guardrails.candidate_validation import (
    is_allowed_arxiv_url,
    validate_arxiv_candidate,
    validate_youtube_candidate,
)
from app.tools.arxiv_search import ArxivPaperTool, parse_arxiv_results
from app.tools.budget import ToolBudget, ToolBudgetExceeded
from app.tools.exa_discovery import ExaDiscoveryTool
from app.tools.youtube_content_search import YoutubeContentSearchTool, parse_youtube_enrichment

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
    assert not is_allowed_arxiv_url("https://arxiv.org.evil.example/abs/1706.03762")
    assert not is_allowed_arxiv_url("https://arxiv.org:443/abs/1706.03762")
    assert not is_allowed_arxiv_url("https://arxiv.org/abs/1706.03762?download=1")
    assert not is_allowed_arxiv_url("https://arxiv.org/abs/not-an-id")


def test_refresh_request_rejects_unbounded_input() -> None:
    with pytest.raises(ValidationError):
        DiscoveryRefreshRequest.model_validate(
            {"concept_ids": [CONCEPT_ID], "concept_names": ["AI"], "unexpected": "private notes"}
        )
    with pytest.raises(ValidationError):
        DiscoveryRefreshRequest.model_validate(
            {"concept_ids": [CONCEPT_ID, SECOND_CONCEPT_ID], "concept_names": ["AI", "Physics"]}
        )


def test_cache_keys_are_versioned_and_do_not_contain_pii() -> None:
    youtube_key = youtube_cache_key(str(CONCEPT_ID), "beginner", "any", 30)
    arxiv_key = arxiv_cache_key(str(CONCEPT_ID), "beginner", 30)
    assert str(CONCEPT_ID) in youtube_key
    assert "email" not in youtube_key
    assert arxiv_key.endswith("discovery-tools-v1")
    assert "current" in arxiv_key
    assert youtube_cache_key(str(CONCEPT_ID), "beginner", "deep_dive", 30) == youtube_cache_key(
        str(CONCEPT_ID), "advanced", "hands_on", 30
    )
    assert arxiv_cache_key(str(CONCEPT_ID), "beginner", 30) != arxiv_cache_key(
        str(CONCEPT_ID), "beginner", 365, "foundational"
    )


def test_query_cache_identity_is_opaque() -> None:
    query = "How does FlashAttention reduce memory usage?"
    key = query_cache_identity(query)
    assert key.startswith("query:")
    assert query.lower() not in key.lower()
    assert query_cache_identity(query) == query_cache_identity(
        "  how   does flashattention reduce memory usage? "
    )


def test_instant_cache_identity_is_opaque_and_intent_scoped() -> None:
    query = "python for beginners"
    key = instant_cache_key("video", query, "best_match")
    assert query not in key
    assert instant_cache_key("video", query, "best_match") != instant_cache_key(
        "video", query, "practical"
    )


def test_cache_serves_a_stale_success_after_fresh_expiry() -> None:
    async def run() -> None:
        cache = DiscoveryCache()
        key = youtube_cache_key(str(CONCEPT_ID), "mixed", "any", 30)
        value = [youtube_candidate().model_dump(mode="json")]
        await cache.set(key, value)
        entry = cache.entries[key]
        entry.expires_at = datetime.now(UTC)
        assert await cache.get(key) is None
        assert await cache.get_stale(key) == value

    asyncio.run(run())


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
            youtube_cache_key(str(CONCEPT_ID), "mixed", "any", 30),
            [youtube_candidate().model_dump(mode="json") for _ in range(6)],
        )
        await cache.set(
            arxiv_cache_key(str(CONCEPT_ID), "mixed", 30),
            [arxiv_candidate(arxiv_id="1706.03762").model_dump(mode="json") for _ in range(2)],
        )
        await cache.set(
            arxiv_cache_key(str(CONCEPT_ID), "mixed", 365, "foundational"),
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


def test_refresh_flow_requires_one_concept_pool() -> None:
    with pytest.raises(ValidationError):
        DiscoveryRefreshRequest(
            concept_ids=[CONCEPT_ID, SECOND_CONCEPT_ID],
            concept_names=["Artificial Intelligence", "Physics"],
        )


def test_single_concept_pools_keep_cache_and_attribution_isolated() -> None:
    class FakeYoutube:
        calls: list[UUID] = []

        async def discover(
            self, request: DiscoveryRefreshRequest, budget: ToolBudget
        ) -> list[YoutubeCandidate]:
            budget.consume("youtube")
            self.calls.append(request.concept_ids[0])
            youtube_id = (
                "dQw4w9WgXcQ"
                if request.concept_ids[0] == CONCEPT_ID
                else "9bZkp7q19f0"
            )
            return [youtube_candidate(request.concept_ids[0]).model_copy(
                update={"youtube_id": youtube_id}
            )]

    class FakeArxiv:
        calls: list[tuple[UUID, str]] = []

        async def discover(
            self, request: DiscoveryRefreshRequest, budget: ToolBudget
        ) -> list[ArxivCandidate]:
            budget.consume(f"arxiv-{request.paper_strategy}")
            self.calls.append((request.concept_ids[0], request.paper_strategy))
            arxiv_id = "1706.03762" if request.concept_ids[0] == CONCEPT_ID else "1800.00001"
            if request.paper_strategy == "foundational":
                arxiv_id = "1810.04805" if request.concept_ids[0] == CONCEPT_ID else "1800.00002"
            return [arxiv_candidate(request.concept_ids[0], request.paper_strategy, arxiv_id)]

    async def run() -> None:
        youtube = FakeYoutube()
        arxiv = FakeArxiv()
        flow = DiscoveryRefreshFlow(DiscoveryCache(), youtube, arxiv, max_tool_calls=3)
        await flow.run_discovery(request())
        second_request = request().model_copy(
            update={"concept_ids": [SECOND_CONCEPT_ID], "concept_names": ["Physics"]}
        )
        await flow.run_discovery(second_request)

        assert youtube.calls == [CONCEPT_ID, SECOND_CONCEPT_ID]
        assert arxiv.calls == [
            (CONCEPT_ID, "current"),
            (CONCEPT_ID, "foundational"),
            (SECOND_CONCEPT_ID, "current"),
            (SECOND_CONCEPT_ID, "foundational"),
        ]
        first_pool = await flow.cache.get(youtube_cache_key(str(CONCEPT_ID), "mixed", "any", 30))
        second_pool = await flow.cache.get(
            youtube_cache_key(str(SECOND_CONCEPT_ID), "mixed", "any", 30)
        )
        assert first_pool and first_pool[0]["matched_concept_ids"] == [str(CONCEPT_ID)]
        assert second_pool and second_pool[0]["matched_concept_ids"] == [str(SECOND_CONCEPT_ID)]

    asyncio.run(run())


def test_tool_budget_is_shared_and_enforced() -> None:
    budget = ToolBudget(2)
    budget.consume("exa")
    budget.consume("youtube-content")
    with pytest.raises(ToolBudgetExceeded):
        budget.consume("arxiv")


def test_optional_enrichment_cannot_starve_mandatory_sources() -> None:
    class FakeYoutube:
        async def discover(
            self, request: DiscoveryRefreshRequest, budget: ToolBudget
        ) -> list[YoutubeCandidate]:
            assert request.level == "mixed"
            assert request.preferred_formats == []
            assert request.audit_user_id is None
            budget.consume("youtube")
            return [youtube_candidate(request.concept_ids[0])]

    class FakeArxiv:
        calls: list[str] = []

        async def discover(
            self, request: DiscoveryRefreshRequest, budget: ToolBudget
        ) -> list[ArxivCandidate]:
            assert request.level == "mixed"
            assert request.preferred_formats == []
            assert request.audit_user_id is None
            budget.consume(f"arxiv-{request.paper_strategy}")
            self.calls.append(request.paper_strategy)
            arxiv_id = "1706.03762" if request.paper_strategy == "current" else "1810.04805"
            return [arxiv_candidate(request.concept_ids[0], request.paper_strategy, arxiv_id)]

    class FakeEnricher:
        called = False

        async def enrich(
            self,
            request: DiscoveryRefreshRequest,
            candidates: list[YoutubeCandidate],
            budget: ToolBudget,
        ) -> list[YoutubeCandidate]:
            del request
            self.called = True
            budget.consume("youtube-content", optional=True)
            return candidates

    async def run() -> None:
        arxiv = FakeArxiv()
        enricher = FakeEnricher()
        flow = DiscoveryRefreshFlow(
            DiscoveryCache(),
            FakeYoutube(),
            arxiv,
            max_tool_calls=3,
            youtube_enricher=enricher,
        )
        result = await flow.run_discovery(request())
        assert arxiv.calls == ["current", "foundational"]
        assert len(result.youtube) == 1
        assert {paper.paper_class for paper in result.arxiv} == {"current", "foundational"}
        assert enricher.called is False

    asyncio.run(run())


def test_youtube_enrichment_requires_structured_evidence() -> None:
    parsed = parse_youtube_enrichment(
        '{"relevant":true,"conceptCoverage":0.9,"estimatedLevel":"beginner",'
        '"learningFormat":"hands_on","hasImplementation":true,'
        '"evidence":["shows a Python implementation"],"confidence":0.8}'
    )
    assert parsed is not None
    assert parsed.learning_format == "hands_on"
    assert parsed.has_implementation is True
    assert parse_youtube_enrichment('{"relevant":true,"confidence":0.8}') is None
    assert parse_youtube_enrichment('{"relevant":true,"unexpected":"value"}') is None
    with pytest.raises(ValidationError):
        YoutubeCandidate.model_validate(
            {
                **youtube_candidate().model_dump(),
                "learning_format": "invented_format",
            }
        )


def test_youtube_enrichment_uses_canonical_concept_and_preserves_base_on_failure() -> None:
    class FakeExa:
        async def search(self, *args: object, **kwargs: object) -> list[dict[str, object]]:
            del kwargs
            assert args[0] == ["Artificial Intelligence"]
            return [{
                "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "title": "A practical lesson",
            }]

    class FakeContent:
        async def analyze(
            self, urls: list[str], concept_name: str, budget: ToolBudget
        ) -> dict[str, YoutubeEnrichment]:
            del budget
            assert concept_name == "Artificial Intelligence"
            return {
                urls[0]: YoutubeEnrichment(
                    relevant=True,
                    concept_coverage=0.9,
                    estimated_level="beginner",
                    learning_format="hands_on",
                    has_implementation=True,
                    evidence=["shows a practical implementation"],
                    confidence=0.8,
                )
            }

    async def run() -> None:
        agent = YoutubeDiscoveryAgent(
            cast(ExaDiscoveryTool, FakeExa()),
            cast(YoutubeContentSearchTool, FakeContent()),
            1,
        )
        base = await agent.discover(request(), ToolBudget(3))
        enriched = await agent.enrich(request(), base, ToolBudget(1))
        assert enriched[0].learning_format == "hands_on"
        assert enriched[0].estimated_level == "beginner"
        assert enriched[0].has_implementation is True

        class FailedContent(FakeContent):
            async def analyze(
                self, urls: list[str], concept_name: str, budget: ToolBudget
            ) -> dict[str, YoutubeEnrichment]:
                del urls, concept_name, budget
                return {}

        preserved = await YoutubeDiscoveryAgent(
            cast(ExaDiscoveryTool, FakeExa()),
            cast(YoutubeContentSearchTool, FailedContent()),
            1,
        ).enrich(request(), base, ToolBudget(1))
        assert preserved[0].learning_format is None
        assert preserved[0].estimated_level is None

    asyncio.run(run())


def test_explicit_query_is_primary_for_youtube_and_paper_search() -> None:
    class FakeExa:
        def __init__(self) -> None:
            self.calls: list[tuple[list[str], str]] = []

        async def search(
            self,
            terms: list[str],
            kind: str,
            *args: object,
            **kwargs: object,
        ) -> list[dict[str, object]]:
            del args, kwargs
            self.calls.append((terms, kind))
            if kind == "video":
                return [
                    {
                        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                        "title": "A practical lesson",
                    }
                ]
            return [
                {
                    "url": "https://arxiv.org/abs/1706.03762",
                    "title": "Attention Is All You Need",
                }
            ]

    class FakeArxiv:
        async def search(self, *args: object, **kwargs: object) -> list[dict[str, object]]:
            del args, kwargs
            return []

    async def run() -> None:
        exa = FakeExa()
        source_request = request().model_copy(update={"query_text": "python for beginners"})
        await YoutubeDiscoveryAgent(
            cast(ExaDiscoveryTool, exa),
            cast(YoutubeContentSearchTool, object()),
            1,
        ).discover(source_request, ToolBudget(3))
        await ArxivDiscoveryAgent(
            cast(ExaDiscoveryTool, exa),
            cast(ArxivPaperTool, FakeArxiv()),
            1,
        ).discover(
            source_request.model_copy(update={"paper_strategy": "current"}), ToolBudget(3)
        )
        assert exa.calls[0] == (["python for beginners"], "video")
        assert exa.calls[1] == (["python for beginners"], "paper")

    asyncio.run(run())


def test_instant_discovery_uses_the_exact_query_and_skips_enrichment() -> None:
    class FakeExa:
        def __init__(self) -> None:
            self.calls: list[tuple[list[str], str, bool]] = []

        async def search(
            self,
            terms: list[str],
            kind: str,
            *args: object,
            **kwargs: object,
        ) -> list[dict[str, object]]:
            del args
            self.calls.append((terms, kind, kwargs.get("interactive") is True))
            if kind == "video":
                return [{
                    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                    "title": "Python for Beginners",
                }]
            return [{
                "url": "https://arxiv.org/abs/1706.03762",
                "title": "Attention Is All You Need",
            }]

    async def run() -> None:
        exa = FakeExa()
        youtube = YoutubeDiscoveryAgent(
            cast(ExaDiscoveryTool, exa), cast(YoutubeContentSearchTool, object()), 1
        )
        arxiv = ArxivDiscoveryAgent(
            cast(ExaDiscoveryTool, exa), cast(ArxivPaperTool, object()), 1
        )
        instant_video = InstantDiscoveryRequest(
            query_text="python for beginners", source_kind="video"
        )
        instant_paper = InstantDiscoveryRequest(
            query_text="efficient transformer attention", source_kind="paper"
        )
        video_results = await youtube.discover_fast(
            DiscoveryRefreshRequest.model_validate({
                "query_text": instant_video.query_text,
                "source_kind": instant_video.source_kind,
            }),
            ToolBudget(1),
        )
        paper_results = await arxiv.discover_fast(
            DiscoveryRefreshRequest.model_validate({
                "query_text": instant_paper.query_text,
                "source_kind": instant_paper.source_kind,
            }),
            ToolBudget(1),
        )
        assert len(video_results) == 1
        assert len(paper_results) == 1
        assert exa.calls == [
            (["python for beginners"], "video", True),
            (["efficient transformer attention"], "paper", True),
        ]

    asyncio.run(run())


def test_query_only_refresh_request_has_empty_concept_arrays() -> None:
    parsed = DiscoveryRefreshRequest.model_validate({"query_text": "Python generators"})
    assert parsed.concept_ids == []
    assert parsed.concept_names == []


def test_foundational_classification_requires_retrieval_evidence() -> None:
    assert has_foundational_evidence("A seminal paper on attention", "")
    assert not has_foundational_evidence("An old paper on attention", "historical result")


def test_foundational_agent_requires_semantic_evidence_for_old_papers() -> None:
    class FakeExa:
        async def search(self, *args: object, **kwargs: object) -> list[dict[str, object]]:
            del args, kwargs
            return [{
                "url": "https://arxiv.org/abs/1706.03762",
                "title": "An old paper on attention",
                "text": "historical result",
            }]

    class EvidenceExa(FakeExa):
        async def search(self, *args: object, **kwargs: object) -> list[dict[str, object]]:
            del args, kwargs
            return [{
                "url": "https://arxiv.org/abs/1706.03762",
                "title": "An old seminal paper on attention",
                "text": "This pioneering work introduced the defining attention architecture.",
            }]

    class FakeArxiv:
        async def search(
            self,
            concept_names: list[str],
            limit: int,
            budget: ToolBudget,
            paper_strategy: str = "current",
        ) -> list[dict[str, object]]:
            del concept_names, limit, budget, paper_strategy
            return []

    async def run() -> None:
        foundational_request = request().model_copy(update={"paper_strategy": "foundational"})
        rejected = await ArxivDiscoveryAgent(
            cast(ExaDiscoveryTool, FakeExa()), cast(ArxivPaperTool, FakeArxiv()), 1
        ).discover(
            foundational_request, ToolBudget(3)
        )
        accepted = await ArxivDiscoveryAgent(
            cast(ExaDiscoveryTool, EvidenceExa()), cast(ArxivPaperTool, FakeArxiv()), 1
        ).discover(
            foundational_request, ToolBudget(3)
        )
        assert rejected == []
        assert accepted[0].paper_class == "foundational"

    asyncio.run(run())


def test_arxiv_parser_prefers_structured_results_and_falls_back_to_fixture_text() -> None:
    structured = parse_arxiv_results(
        [{"arxiv_id": "1706.03762", "title": "Attention Is All You Need", "abstract": "A paper"}],
        1,
    )
    assert structured[0]["url"] == "https://arxiv.org/abs/1706.03762"
    fixture = parse_arxiv_results(
        "Title: Attention Is All You Need\nhttps://arxiv.org/abs/1706.03762", 1
    )
    assert fixture[0]["title"] == "Attention Is All You Need"


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
