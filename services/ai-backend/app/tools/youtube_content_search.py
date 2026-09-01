import asyncio
from typing import Any

from app.tools.budget import ToolBudget, ToolBudgetExceeded


class YoutubeContentSearchTool:
    name = "youtube_content_search"
    version = "youtube-content-v1"

    def __init__(
        self,
        enabled: bool = False,
        embedder_provider: str = "openai",
        embedder_model: str = "text-embedding-3-small",
    ) -> None:
        self.enabled = enabled
        self.embedder_provider = embedder_provider
        self.embedder_model = embedder_model

    async def analyze(self, urls: list[str], budget: ToolBudget) -> dict[str, dict[str, Any]]:
        if not self.enabled:
            return {}
        from crewai_tools import YoutubeVideoSearchTool

        result: dict[str, dict[str, Any]] = {}
        for url in urls[: min(5, budget.remaining)]:
            try:
                budget.consume(self.name)
                tool = YoutubeVideoSearchTool(
                    youtube_video_url=url,
                    config={
                        "embedding_model": {
                            "provider": self.embedder_provider,
                            "config": {"model": self.embedder_model},
                        }
                    },
                )
                content = await asyncio.to_thread(
                    tool.run,
                    "Assess whether this video teaches the requested concept, "
                    "including its format and level.",
                )
            except ToolBudgetExceeded:
                raise
            except Exception:
                continue
            result[url] = {
                "learningFormat": "clear_explanations",
                "estimatedLevel": "mixed",
                "evidence": str(content)[:800],
            }
        return result
