from app.agents.arxiv_discovery import ArxivDiscoveryAgent
from app.agents.youtube_discovery import YoutubeDiscoveryAgent
from app.cache.discovery_cache import DiscoveryCache
from app.config import Settings
from app.contracts.discovery import DiscoveryCandidateBatch, DiscoveryRefreshRequest
from app.flows.discovery_refresh import DiscoveryRefreshFlow
from app.tools.arxiv_search import ArxivPaperTool
from app.tools.exa_discovery import ExaDiscoveryTool
from app.tools.youtube_content_search import YoutubeContentSearchTool


class AgentRuntime:
    def __init__(self, settings: Settings, cache: DiscoveryCache | None = None) -> None:
        exa = ExaDiscoveryTool(settings.exa_api_key, settings.request_timeout_seconds)
        self.flow = DiscoveryRefreshFlow(
            cache or DiscoveryCache(redis_url=settings.redis_url),
            YoutubeDiscoveryAgent(
                exa,
                YoutubeContentSearchTool(
                    settings.agents_enabled,
                    settings.youtube_embedder_provider,
                    settings.youtube_embedder_model,
                ),
                min(10, settings.max_tool_calls),
            ),
            ArxivDiscoveryAgent(
                exa, ArxivPaperTool(settings.agents_enabled), min(10, settings.max_tool_calls)
            ),
            settings.max_tool_calls,
        )
        self.settings = settings

    async def run_discovery(self, request: DiscoveryRefreshRequest) -> DiscoveryCandidateBatch:
        if not self.settings.agents_enabled:
            return DiscoveryCandidateBatch(
                trace_id=request.trace_id or "agents-disabled", failures=["agents_disabled"]
            )
        return await self.flow.run_discovery(request)
