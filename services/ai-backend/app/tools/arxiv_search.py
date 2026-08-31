import asyncio
import re
from typing import Any


class ArxivPaperTool:
    name = "arxiv_paper_search"
    version = "arxiv-paper-v1"

    def __init__(self, enabled: bool = False) -> None:
        self.enabled = enabled

    async def search(self, concept_names: list[str], limit: int) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        from crewai_tools import ArxivPaperTool

        try:
            tool = ArxivPaperTool(download_pdfs=False)
            content = await asyncio.to_thread(
                tool.run,
                search_query=" ".join(concept_names),
                max_results=min(10, max(1, limit)),
            )
        except Exception:
            return []
        text = str(content)
        matches = re.finditer(
            r"Title:\s*(?P<title>[^\n]+).*?https://arxiv.org/(?:abs|pdf)/(?P<id>[^\s)]+)",
            text,
            re.IGNORECASE | re.DOTALL,
        )
        return [
            {
                "url": f"https://arxiv.org/abs/{match.group('id').removesuffix('.pdf')}",
                "title": match.group("title").strip(),
                "text": text[max(0, match.start()) : match.end()][:800],
            }
            for match in list(matches)[:limit]
        ]
