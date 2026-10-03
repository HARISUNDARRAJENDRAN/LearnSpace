import asyncio
from typing import cast

import pytest

from app.agents.arxiv_discovery import ArxivDiscoveryAgent
from app.contracts.discovery import DiscoveryRefreshRequest
from app.guardrails.candidate_validation import canonical_arxiv_url
from app.tools.arxiv_search import ArxivPaperTool
from app.tools.budget import ToolBudget
from app.tools.exa_discovery import ExaDiscoveryTool


@pytest.mark.parametrize(
    "path",
    [
        "abs/1706.03762",
        "abs/1706.03762v5",
        "pdf/1706.03762v5.pdf",
        "pdf/1706.03762",
        "html/1706.03762v5",
    ],
)
def test_normalizes_document_links(path: str) -> None:
    assert canonical_arxiv_url(f"https://arxiv.org/{path}") == "https://arxiv.org/abs/1706.03762"


@pytest.mark.parametrize(
    "url",
    [
        "https://arxiv.org.evil.example/pdf/1706.03762",
        "http://arxiv.org/pdf/1706.03762",
        "https://arxiv.org:443/pdf/1706.03762",
        "https://user@arxiv.org/pdf/1706.03762",
        "https://arxiv.org/pdf/not-a-paper",
        "https://arxiv.org/pdf/1706.03762?redirect=evil",
        "https://arxiv.org/other/1706.03762",
        "https://arxiv.org:invalid/pdf/1706.03762",
        "https://arxiv.org/pdf/1706.03762#other",
    ],
)
def test_rejects_untrusted_or_invalid_document_links(url: str) -> None:
    assert canonical_arxiv_url(url) is None


def test_paper_discovery_deduplicates_document_formats() -> None:
    class Exa:
        async def search(self, *args: object, **kwargs: object) -> list[dict[str, object]]:
            return [
                {"url": f"https://arxiv.org/{path}", "title": "Attention Is All You Need"}
                for path in ["pdf/1706.03762v5", "html/1706.03762v3", "abs/1706.03762"]
            ]

    async def run() -> None:
        agent = ArxivDiscoveryAgent(cast(ExaDiscoveryTool, Exa()), cast(ArxivPaperTool, object()))
        result = await agent.discover_fast(
            DiscoveryRefreshRequest(
                query_text="attention", source_kind="paper", ranking_intent="best_match"
            ),
            ToolBudget(1),
        )
        assert len(result) == 1
        assert result[0].arxiv_id == "1706.03762"
        assert result[0].canonical_url == "https://arxiv.org/abs/1706.03762"

    asyncio.run(run())
