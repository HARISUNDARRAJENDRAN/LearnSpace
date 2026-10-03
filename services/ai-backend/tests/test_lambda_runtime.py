import asyncio
from dataclasses import replace
from typing import cast

import pytest

from app.cache.discovery_cache import DiscoveryCache
from app.config import Settings
from app.contracts.discovery import (
    DiscoveryCandidateBatch,
    InstantDiscoveryRequest,
    YoutubeCandidate,
)
from app.runtime.agent_runtime import AgentRuntime


@pytest.mark.parametrize("stale", [False, True])
def test_lambda_finishes_fetch_and_cache_before_returning(
    monkeypatch: pytest.MonkeyPatch, stale: bool
) -> None:
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "learnspace-discovery-agent-staging")

    async def run() -> None:
        cache = DiscoveryCache()
        settings = replace(
            Settings.from_env(),
            agents_enabled=True,
            exa_api_key="test",
            interactive_timeout_seconds=0.001,
            request_timeout_seconds=1,
        )
        lesson = YoutubeCandidate(
            youtube_id="AbCdEfGhIjK",
            canonical_url="https://youtube.com/watch?v=AbCdEfGhIjK",
            title="Python generators",
            confidence=0.9,
        )
        writes: list[str] = []

        class Runtime(AgentRuntime):
            async def _fetch_instant(
                self, request: InstantDiscoveryRequest
            ) -> DiscoveryCandidateBatch:
                await asyncio.sleep(0.01)
                return DiscoveryCandidateBatch(trace_id="lambda-test", youtube=[lesson])

            async def _cache_instant(
                self, request: InstantDiscoveryRequest, key: str, batch: DiscoveryCandidateBatch
            ) -> None:
                await asyncio.sleep(0.01)
                writes.append(key)

        async def get_stale(key: str) -> list[dict[str, object]] | None:
            del key
            return [cast(dict[str, object], lesson.model_dump(mode="json"))] if stale else None

        monkeypatch.setattr(cache, "get_stale", get_stale)
        runtime = Runtime(settings, cache)
        result = await runtime.run_instant_discovery(
            InstantDiscoveryRequest(query_text="python generators", source_kind="video")
        )
        assert result.youtube == [lesson]
        assert len(writes) == 1
        assert not result.failures
        assert not vars(runtime)["_instant_inflight"]
        assert not vars(runtime)["_instant_refreshes"]
        assert len(asyncio.all_tasks()) == 1

    asyncio.run(run())


@pytest.mark.parametrize("stale", [False, True])
def test_lambda_failure_uses_stale_or_returns_a_terminal_failure(
    monkeypatch: pytest.MonkeyPatch, stale: bool
) -> None:
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "learnspace-discovery-agent-staging")

    async def run() -> None:
        settings = replace(Settings.from_env(), agents_enabled=True, exa_api_key="test")
        cache = DiscoveryCache()
        lesson = YoutubeCandidate(
            youtube_id="AbCdEfGhIjK",
            canonical_url="https://youtube.com/watch?v=AbCdEfGhIjK",
            title="Python generators",
            confidence=0.9,
        )

        class Runtime(AgentRuntime):
            async def _fetch_instant(
                self, request: InstantDiscoveryRequest
            ) -> DiscoveryCandidateBatch:
                raise TimeoutError("bounded provider timeout")

        async def get_stale(key: str) -> list[dict[str, object]] | None:
            del key
            return [cast(dict[str, object], lesson.model_dump(mode="json"))] if stale else None

        monkeypatch.setattr(cache, "get_stale", get_stale)
        result = await Runtime(settings, cache).run_instant_discovery(
            InstantDiscoveryRequest(query_text="python generators", source_kind="video")
        )
        if stale:
            assert result.cache_hit and result.youtube == [lesson]
        else:
            assert result.failures == ["instant:TimeoutError"]
        assert len(asyncio.all_tasks()) == 1

    asyncio.run(run())
