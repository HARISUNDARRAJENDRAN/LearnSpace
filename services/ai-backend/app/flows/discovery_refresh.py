import asyncio
from collections.abc import Awaitable, Callable
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


class YoutubeDiscoverer(Protocol):
    async def discover(self, request: DiscoveryRefreshRequest) -> list[YoutubeCandidate]: ...


class ArxivDiscoverer(Protocol):
    async def discover(self, request: DiscoveryRefreshRequest) -> list[ArxivCandidate]: ...


class DiscoveryFlowState(BaseModel):
    pass


class DiscoveryRefreshFlow(Flow[DiscoveryFlowState]):
    def __init__(
        self,
        cache: DiscoveryCache,
        youtube: YoutubeDiscoverer,
        arxiv: ArxivDiscoverer,
        max_tool_calls: int = 4,
    ) -> None:
        super().__init__()
        self.cache = cache
        self.youtube = youtube
        self.arxiv = arxiv
        self.max_tool_calls = max_tool_calls

    async def run_discovery(self, request: DiscoveryRefreshRequest) -> DiscoveryCandidateBatch:
        trace_id = request.trace_id or str(uuid4())
        format_key = request.preferred_formats[0] if request.preferred_formats else "any"
        youtube_keys = [
            youtube_cache_key(str(concept_id), request.level, format_key, request.window_days)
            for concept_id in request.concept_ids
        ]
        arxiv_keys = [
            arxiv_cache_key(str(concept_id), request.level, request.window_days)
            for concept_id in request.concept_ids
        ]
        youtube_ready = await self.cache.has_enough(youtube_keys, 6)
        arxiv_ready = await self.cache.has_enough(arxiv_keys, 4)
        skipped: list[ResourceKind] = []
        youtube_candidates: list[YoutubeCandidate] = []
        arxiv_candidates: list[ArxivCandidate] = []
        failures: list[str] = []
        if youtube_ready:
            skipped.append("video")
            youtube_candidates = await self._cached_youtube(youtube_keys)
        else:
            try:
                youtube_candidates = await self._retry(lambda: self.youtube.discover(request))
                await self._cache_youtube(youtube_keys, youtube_candidates)
            except Exception as error:
                failures.append(f"youtube:{type(error).__name__}")
        if arxiv_ready:
            skipped.append("paper")
            arxiv_candidates = await self._cached_arxiv(arxiv_keys)
        else:
            try:
                arxiv_candidates = await self._retry(lambda: self.arxiv.discover(request))
                await self._cache_arxiv(arxiv_keys, arxiv_candidates)
            except Exception as error:
                failures.append(f"arxiv:{type(error).__name__}")
        return DiscoveryCandidateBatch(
            trace_id=trace_id,
            skipped=skipped,
            youtube=self._dedupe_youtube(youtube_candidates),
            arxiv=self._dedupe_arxiv(arxiv_candidates),
            cache_hit=youtube_ready or arxiv_ready,
            failures=failures,
            audit_run_id=uuid4(),
        )

    async def _retry(self, operation: Callable[[], Awaitable[list[Any]]]) -> list[Any]:
        for attempt in range(2):
            try:
                return await asyncio.wait_for(operation(), timeout=8)
            except Exception as error:
                if attempt == 1 or not self._retryable(error):
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

    async def _cached_youtube(self, keys: list[str]) -> list[YoutubeCandidate]:
        result: list[YoutubeCandidate] = []
        for key in keys:
            for item in await self.cache.get(key) or []:
                try:
                    candidate = YoutubeCandidate.model_validate(item)
                except Exception:
                    continue
                valid = validate_youtube_candidate(candidate)
                if valid is not None:
                    result.append(valid)
        return result

    async def _cached_arxiv(self, keys: list[str]) -> list[ArxivCandidate]:
        result: list[ArxivCandidate] = []
        for key in keys:
            for item in await self.cache.get(key) or []:
                try:
                    candidate = ArxivCandidate.model_validate(item)
                except Exception:
                    continue
                valid = validate_arxiv_candidate(candidate)
                if valid is not None:
                    result.append(valid)
        return result

    async def _cache_youtube(self, keys: list[str], candidates: list[YoutubeCandidate]) -> None:
        value = [candidate.model_dump(mode="json") for candidate in candidates]
        ttl = YOUTUBE_TTL if candidates else NEGATIVE_TTL
        for key in keys:
            await self.cache.set(key, value, ttl)

    async def _cache_arxiv(self, keys: list[str], candidates: list[ArxivCandidate]) -> None:
        value = [candidate.model_dump(mode="json") for candidate in candidates]
        ttl = ARXIV_TTL if candidates else NEGATIVE_TTL
        for key in keys:
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
