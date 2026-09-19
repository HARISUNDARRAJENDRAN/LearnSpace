import asyncio
import logging
from collections.abc import Awaitable, Callable
from functools import partial
from typing import Any, Protocol
from uuid import uuid4

import httpx
from crewai.flow import Flow
from pydantic import BaseModel

from app.cache.discovery_cache import (
    ARXIV_TTL,
    NEGATIVE_TTL,
    YOUTUBE_TTL,
    DiscoveryCache,
    arxiv_cache_key,
    query_cache_identity,
    youtube_cache_key,
)
from app.contracts.discovery import (
    ArxivCandidate,
    DiscoveryCandidateBatch,
    DiscoveryRefreshRequest,
    ResourceKind,
    YoutubeCandidate,
)
from app.guardrails.candidate_validation import validate_arxiv_candidate, validate_youtube_candidate
from app.tools.budget import ToolBudget, ToolBudgetExceeded

logger = logging.getLogger(__name__)


class YoutubeDiscoverer(Protocol):
    async def discover(
        self, request: DiscoveryRefreshRequest, budget: ToolBudget
    ) -> list[YoutubeCandidate]: ...


class YoutubeEnricher(Protocol):
    async def enrich(
        self,
        request: DiscoveryRefreshRequest,
        candidates: list[YoutubeCandidate],
        budget: ToolBudget,
    ) -> list[YoutubeCandidate]: ...


class ArxivDiscoverer(Protocol):
    async def discover(
        self, request: DiscoveryRefreshRequest, budget: ToolBudget
    ) -> list[ArxivCandidate]: ...


class DiscoveryFlowState(BaseModel):
    pass


class DiscoveryRefreshFlow(Flow[DiscoveryFlowState]):
    def __init__(
        self,
        cache: DiscoveryCache,
        youtube: YoutubeDiscoverer,
        arxiv: ArxivDiscoverer,
        max_tool_calls: int = 4,
        request_timeout_seconds: float = 8.0,
        youtube_enricher: YoutubeEnricher | None = None,
    ) -> None:
        super().__init__()
        self.cache = cache
        self.youtube = youtube
        self.arxiv = arxiv
        self.max_tool_calls = max_tool_calls
        self.request_timeout_seconds = request_timeout_seconds
        self.youtube_enricher = youtube_enricher

    async def run_discovery(self, request: DiscoveryRefreshRequest) -> DiscoveryCandidateBatch:
        trace_id = request.trace_id or str(uuid4())
        neutral_request = request.model_copy(
            update={"level": "mixed", "preferred_formats": [], "audit_user_id": None}
        )
        format_key = "any"
        budget = ToolBudget(self.max_tool_calls)
        if not request.concept_ids and not request.query_text:
            raise ValueError("discovery refresh requires a canonical concept or query text")
        budget.reserve_primary(3)
        skipped: list[ResourceKind] = []
        youtube_candidates: list[YoutubeCandidate] = []
        arxiv_candidates: list[ArxivCandidate] = []
        youtube_pools: list[tuple[DiscoveryRefreshRequest, list[YoutubeCandidate], bool]] = []
        failures: list[str] = []
        videos_ready = request.source_kind == "paper"
        papers_ready = request.source_kind == "video"
        cache_hit = False
        search_pools = list(zip(request.concept_ids, request.concept_names, strict=False)) or [
            (None, request.query_text or "")
        ]
        for concept_id, concept_name in search_pools:
            concept_key = (
                query_cache_identity(request.query_text)
                if request.query_text
                else str(concept_id or concept_name)
            )
            pool_request = neutral_request.model_copy(
                update={
                    "concept_ids": [concept_id] if concept_id else [],
                    "concept_names": [concept_name] if concept_id else [],
                }
            )
            youtube_key = youtube_cache_key(
                concept_key, neutral_request.level, format_key, request.window_days
            )
            if not request.force_refresh and await self.cache.has_enough([youtube_key], 6):
                cache_hit = True
                if request.source_kind != "paper":
                    videos_ready = True
                cached = await self._cached_youtube(youtube_key, concept_id)
                youtube_candidates.extend(cached)
                budget.release_primary()
                youtube_pools.append((pool_request, cached, False))
            else:
                if request.source_kind != "paper":
                    videos_ready = False
                try:
                    candidates = [] if request.source_kind == "paper" else await self._retry(
                        partial(self.youtube.discover, pool_request, budget), budget
                    )
                    candidates = [
                        candidate
                        for candidate in candidates
                        if concept_id is None or concept_id in candidate.matched_concept_ids
                    ]
                    youtube_candidates.extend(candidates)
                    youtube_pools.append((pool_request, candidates, request.source_kind != "paper"))
                    await self._cache_youtube(youtube_key, candidates)
                except Exception as error:
                    if len(failures) < 10:
                        failures.append(f"youtube:{concept_key}:{type(error).__name__}")
                    stale_candidates = await self._cached_youtube(
                        youtube_key, concept_id, stale=True
                    )
                    youtube_candidates.extend(stale_candidates)
                    youtube_pools.append((pool_request, stale_candidates, False))

            if request.source_kind == "video":
                continue
            for paper_strategy in ("current", "foundational"):
                paper_request = neutral_request.model_copy(
                    update={
                        "concept_ids": [concept_id] if concept_id else [],
                        "concept_names": [concept_name] if concept_id else [],
                        "paper_strategy": paper_strategy,
                        "window_days": request.window_days if paper_strategy == "current" else 365,
                    }
                )
                arxiv_key = arxiv_cache_key(
                    concept_key, neutral_request.level, paper_request.window_days, paper_strategy
                )
                if not request.force_refresh and await self.cache.has_enough([arxiv_key], 2):
                    cache_hit = True
                    papers_ready = True
                    arxiv_candidates.extend(await self._cached_arxiv(arxiv_key, concept_id))
                    budget.release_primary()
                else:
                    papers_ready = False
                    try:
                        candidates = await self._retry(
                            partial(self.arxiv.discover, paper_request, budget), budget
                        )
                        candidates = [
                            candidate
                            for candidate in candidates
                            if concept_id is None or concept_id in candidate.matched_concept_ids
                        ]
                        arxiv_candidates.extend(candidates)
                        await self._cache_arxiv(arxiv_key, candidates)
                    except Exception as error:
                        if len(failures) < 10:
                            failures.append(
                                f"arxiv:{concept_key}:{paper_strategy}:{type(error).__name__}"
                            )
                        arxiv_candidates.extend(
                            await self._cached_arxiv(arxiv_key, concept_id, stale=True)
                        )
        budget.begin_optional_phase()
        if self.youtube_enricher is not None:
            for index, (pool_request, candidates, can_enrich) in enumerate(youtube_pools):
                if not can_enrich or not candidates or budget.remaining <= 0:
                    continue
                try:
                    enriched = await self._retry(
                        partial(self.youtube_enricher.enrich, pool_request, candidates, budget),
                        budget,
                        optional=True,
                    )
                except ToolBudgetExceeded:
                    break
                except Exception as error:
                    if len(failures) < 10:
                        failure_identity = (
                            query_cache_identity(pool_request.query_text)
                            if pool_request.query_text
                            else pool_request.concept_names[0]
                            if pool_request.concept_names
                            else "unknown"
                        )
                        failures.append(
                            f"youtube-enrichment:{failure_identity}:{type(error).__name__}"
                        )
                    continue
                youtube_pools[index] = (pool_request, enriched, True)
        if youtube_pools:
            youtube_candidates = [
                candidate for _, candidates, _ in youtube_pools for candidate in candidates
            ]
        if request.source_kind == "video":
            arxiv_candidates = []
        if request.source_kind == "paper":
            youtube_candidates = []
        if videos_ready:
            skipped.append("video")
        if papers_ready:
            skipped.append("paper")
        batch = DiscoveryCandidateBatch(
            trace_id=trace_id,
            skipped=skipped,
            youtube=self._dedupe_youtube(youtube_candidates),
            arxiv=self._dedupe_arxiv(arxiv_candidates),
            cache_hit=cache_hit,
            failures=failures,
            audit_run_id=uuid4(),
            provider_calls=budget.call_counts.get("exa_discovery", 0),
            fallback_calls=budget.call_counts.get("arxiv_paper_search", 0),
            enrichment_calls=budget.call_counts.get("youtube_content_search", 0),
        )
        logger.info(
            "discovery_refresh_completed",
            extra={
                "trace_id": trace_id,
                "cache_hit": cache_hit,
                "videos": len(batch.youtube),
                "papers": len(batch.arxiv),
                "failures": len(batch.failures),
                "tool_calls_used": budget.used,
                "tool_calls_limit": budget.limit,
            },
        )
        return batch

    async def _retry(
        self,
        operation: Callable[[], Awaitable[list[Any]]],
        budget: ToolBudget,
        optional: bool = False,
    ) -> list[Any]:
        for attempt in range(2):
            try:
                return await asyncio.wait_for(operation(), timeout=self.request_timeout_seconds)
            except Exception as error:
                if attempt == 1 or not self._retryable(error):
                    raise
                if not optional and budget.remaining <= budget.primary_reserved:
                    raise
                await asyncio.sleep(0.2)
        return []

    @staticmethod
    def _retryable(error: Exception) -> bool:
        if isinstance(
            error, (TimeoutError, asyncio.TimeoutError, httpx.TimeoutException, httpx.NetworkError)
        ):
            return True
        return isinstance(error, httpx.HTTPStatusError) and error.response.status_code in {
            429,
            500,
            502,
            503,
            504,
        }

    async def _cached_youtube(
        self, key: str, concept_id: Any, stale: bool = False
    ) -> list[YoutubeCandidate]:
        result: list[YoutubeCandidate] = []
        values = await (self.cache.get_stale(key) if stale else self.cache.get(key))
        for item in values or []:
            try:
                candidate = YoutubeCandidate.model_validate(item)
            except Exception:
                continue
            valid = validate_youtube_candidate(candidate)
            if valid is not None and (
                concept_id is None or concept_id in valid.matched_concept_ids
            ):
                result.append(valid)
        return result

    async def _cached_arxiv(
        self, key: str, concept_id: Any, stale: bool = False
    ) -> list[ArxivCandidate]:
        result: list[ArxivCandidate] = []
        values = await (self.cache.get_stale(key) if stale else self.cache.get(key))
        for item in values or []:
            try:
                candidate = ArxivCandidate.model_validate(item)
            except Exception:
                continue
            valid = validate_arxiv_candidate(candidate)
            if valid is not None and (
                concept_id is None or concept_id in valid.matched_concept_ids
            ):
                result.append(valid)
        return result

    async def _cache_youtube(self, key: str, candidates: list[YoutubeCandidate]) -> None:
        value = [candidate.model_dump(mode="json") for candidate in candidates]
        ttl = YOUTUBE_TTL if candidates else NEGATIVE_TTL
        await self.cache.set(key, value, ttl)

    async def _cache_arxiv(self, key: str, candidates: list[ArxivCandidate]) -> None:
        value = [candidate.model_dump(mode="json") for candidate in candidates]
        ttl = ARXIV_TTL if candidates else NEGATIVE_TTL
        await self.cache.set(key, value, ttl)

    @staticmethod
    def _dedupe_youtube(candidates: list[YoutubeCandidate]) -> list[YoutubeCandidate]:
        seen: set[str] = set()
        result: list[YoutubeCandidate] = []
        for candidate in candidates:
            if candidate.youtube_id not in seen:
                seen.add(candidate.youtube_id)
                result.append(candidate)
        return result[:50]

    @staticmethod
    def _dedupe_arxiv(candidates: list[ArxivCandidate]) -> list[ArxivCandidate]:
        seen: set[str] = set()
        result: list[ArxivCandidate] = []
        for candidate in candidates:
            if candidate.arxiv_id not in seen:
                seen.add(candidate.arxiv_id)
                result.append(candidate)
        return result[:50]
