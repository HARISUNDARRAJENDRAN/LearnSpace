import asyncio
import os
from datetime import timedelta
from typing import Protocol, cast

from app.agents.arxiv_discovery import ArxivDiscoveryAgent
from app.agents.youtube_discovery import YoutubeDiscoveryAgent
from app.cache.discovery_cache import DiscoveryCache, instant_cache_key
from app.config import Settings
from app.contracts.discovery import (
    ArxivCandidate,
    DiscoveryCandidateBatch,
    DiscoveryRefreshRequest,
    InstantDiscoveryRequest,
    YoutubeCandidate,
)
from app.flows.discovery_refresh import DiscoveryRefreshFlow
from app.tools.arxiv_search import ArxivPaperTool
from app.tools.budget import ToolBudget
from app.tools.exa_discovery import ExaDiscoveryTool
from app.tools.youtube_content_search import YoutubeContentSearchTool


class FastYoutubeDiscoverer(Protocol):
    async def discover_fast(
        self, request: DiscoveryRefreshRequest, budget: ToolBudget, limit: int
    ) -> list[YoutubeCandidate]: ...


class FastArxivDiscoverer(Protocol):
    async def discover_fast(
        self, request: DiscoveryRefreshRequest, budget: ToolBudget, limit: int
    ) -> list[ArxivCandidate]: ...


class AgentRuntime:
    def __init__(self, settings: Settings, cache: DiscoveryCache | None = None) -> None:
        exa = ExaDiscoveryTool(settings.exa_api_key, settings.request_timeout_seconds)
        youtube = YoutubeDiscoveryAgent(
            exa,
            YoutubeContentSearchTool(settings.youtube_enrichment_enabled),
            min(10, settings.max_tool_calls),
        )
        arxiv = ArxivDiscoveryAgent(
            exa, ArxivPaperTool(settings.agents_enabled), min(10, settings.max_tool_calls)
        )
        self.flow = DiscoveryRefreshFlow(
            cache or DiscoveryCache(redis_url=settings.redis_url),
            youtube,
            arxiv,
            settings.max_tool_calls,
            settings.request_timeout_seconds,
            youtube_enricher=youtube,
        )
        self.settings = settings
        self._instant_refreshes: dict[str, asyncio.Task[None]] = {}
        self._instant_inflight: dict[str, asyncio.Task[DiscoveryCandidateBatch]] = {}

    async def run_discovery(self, request: DiscoveryRefreshRequest) -> DiscoveryCandidateBatch:
        if not self.settings.agents_enabled:
            return DiscoveryCandidateBatch(
                trace_id=request.trace_id or "agents-disabled", failures=["agents_disabled"]
            )
        return await self.flow.run_discovery(request)

    async def run_instant_discovery(
        self, request: InstantDiscoveryRequest
    ) -> DiscoveryCandidateBatch:
        trace_id = request.trace_id or "instant-discovery"
        if not self.settings.agents_enabled:
            return DiscoveryCandidateBatch(trace_id=trace_id, failures=["agents_disabled"])
        key = instant_cache_key(request.source_kind, request.query_text, request.ranking_intent)
        cached = await self.flow.cache.get(key)
        if cached is not None:
            return self._cached_batch(request, cached, trace_id)
        stale = await self.flow.cache.get_stale(key)
        if os.getenv("AWS_LAMBDA_FUNCTION_NAME"):
            # Lambda freezes the event loop after returning. Finish provider
            # work and cache writes in this invocation; Next.js still returns
            # its partial response within the independent interactive budget.
            try:
                batch = await asyncio.wait_for(
                    self._fetch_instant(request), timeout=self.settings.request_timeout_seconds
                )
                await self._cache_instant(request, key, batch)
                return batch
            except Exception as error:
                if stale is not None:
                    return self._cached_batch(request, stale, trace_id)
                return DiscoveryCandidateBatch(
                    trace_id=trace_id, failures=[f"instant:{type(error).__name__}"]
                )
        if stale is not None:
            if key not in self._instant_refreshes or self._instant_refreshes[key].done():
                task = asyncio.create_task(self._refresh_instant(request, key))
                self._instant_refreshes[key] = task
                task.add_done_callback(lambda completed: self._clear_refresh(key, completed))
            return self._cached_batch(request, stale, trace_id)
        inflight = self._instant_inflight.get(key)
        if inflight is None:
            inflight = asyncio.create_task(self._fetch_instant(request))
            self._instant_inflight[key] = inflight
            asyncio.create_task(self._finish_instant(request, key, inflight))
        try:
            batch = await asyncio.wait_for(
                asyncio.shield(inflight),
                timeout=self.settings.interactive_timeout_seconds,
            )
        except Exception as error:
            return DiscoveryCandidateBatch(
                trace_id=trace_id, failures=[f"instant:{type(error).__name__}"]
            )
        return batch

    async def _finish_instant(
        self,
        request: InstantDiscoveryRequest,
        key: str,
        inflight: asyncio.Task[DiscoveryCandidateBatch],
    ) -> None:
        try:
            await self._cache_instant(request, key, await inflight)
        except Exception:
            pass
        finally:
            if self._instant_inflight.get(key) is inflight:
                self._instant_inflight.pop(key, None)

    async def _refresh_instant(self, request: InstantDiscoveryRequest, key: str) -> None:
        try:
            batch = await self._fetch_instant(request)
            await self._cache_instant(request, key, batch)
        except Exception:
            return

    def _clear_refresh(self, key: str, task: asyncio.Task[None]) -> None:
        if self._instant_refreshes.get(key) is task:
            self._instant_refreshes.pop(key, None)

    async def _fetch_instant(self, request: InstantDiscoveryRequest) -> DiscoveryCandidateBatch:
        discovery_request = DiscoveryRefreshRequest(
            query_text=request.query_text,
            source_kind=request.source_kind,
            window_days=365,
            ranking_intent=request.ranking_intent,
            paper_strategy=(
                "foundational" if request.ranking_intent == "foundational" else "current"
            ),
            trace_id=request.trace_id,
        )
        budget = ToolBudget(1)
        if request.source_kind == "video":
            youtube = cast(FastYoutubeDiscoverer, self.flow.youtube)
            candidates = await youtube.discover_fast(discovery_request, budget, request.limit)
            return DiscoveryCandidateBatch(
                trace_id=request.trace_id or "instant-discovery",
                youtube=candidates[: request.limit],
                provider_calls=budget.call_counts.get("exa_discovery", 0),
            )
        arxiv = cast(FastArxivDiscoverer, self.flow.arxiv)
        candidates = await arxiv.discover_fast(discovery_request, budget, request.limit)
        return DiscoveryCandidateBatch(
            trace_id=request.trace_id or "instant-discovery",
            arxiv=candidates[: request.limit],
            provider_calls=budget.call_counts.get("exa_discovery", 0),
        )

    async def _cache_instant(
        self, request: InstantDiscoveryRequest, key: str, batch: DiscoveryCandidateBatch
    ) -> None:
        if batch.failures:
            return
        values = (
            [candidate.model_dump(mode="json") for candidate in batch.youtube]
            if request.source_kind == "video"
            else [candidate.model_dump(mode="json") for candidate in batch.arxiv]
        )
        if not values:
            return
        await self.flow.cache.set(key, values, timedelta(minutes=10))

    @staticmethod
    def _cached_batch(
        request: InstantDiscoveryRequest, values: list[dict[str, object]], trace_id: str
    ) -> DiscoveryCandidateBatch:
        if request.source_kind == "video":
            youtube: list[YoutubeCandidate] = []
            for value in values:
                try:
                    youtube.append(YoutubeCandidate.model_validate(value))
                except Exception:
                    continue
            return DiscoveryCandidateBatch(
                trace_id=trace_id, youtube=youtube[: request.limit], cache_hit=True
            )
        arxiv: list[ArxivCandidate] = []
        for value in values:
            try:
                arxiv.append(ArxivCandidate.model_validate(value))
            except Exception:
                continue
        return DiscoveryCandidateBatch(
            trace_id=trace_id, arxiv=arxiv[: request.limit], cache_hit=True
        )
