from datetime import UTC, datetime, timedelta
from typing import Any, cast
from urllib.parse import urlparse

import httpx

from app.contracts.discovery import ResourceKind
from app.guardrails.candidate_validation import is_allowed_arxiv_url, youtube_id_from_url
from app.tools.budget import ToolBudget


class ExaDiscoveryTool:
    name = "exa_discovery"
    version = "exa-discovery-v1"

    def __init__(self, api_key: str | None, timeout_seconds: float = 8.0) -> None:
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds

    async def search(
        self,
        concept_names: list[str],
        resource_kind: ResourceKind,
        window_days: int,
        limit: int,
        budget: ToolBudget,
        paper_strategy: str = "current",
        interactive: bool = False,
    ) -> list[dict[str, Any]]:
        if not self.api_key:
            return []
        budget.consume(self.name)
        domain = "youtube.com" if resource_kind == "video" else "arxiv.org"
        explicit_query = " ".join(value.strip() for value in concept_names if value.strip()).strip()
        query = (
            f"videos on {explicit_query}"
            if interactive and resource_kind == "video"
            else explicit_query
            if interactive
            else " educational " + explicit_query
        )
        if not interactive and resource_kind == "paper" and paper_strategy == "foundational":
            query = (
                "seminal foundational landmark canonical original influential early defining "
                "research paper " + " ".join(concept_names)
            )
        elif not interactive and resource_kind == "paper":
            query = "recent current research paper " + " ".join(concept_names)
        payload = {
            "query": query,
            "type": "instant" if interactive else "neural",
            "numResults": min(30 if interactive else 10, max(1, limit)),
            "includeDomains": (
                ["youtube.com", "youtu.be"]
                if interactive and resource_kind == "video"
                else [domain]
            ),
            "contents": {"highlights": {"maxCharacters": 800}},
        }
        if not interactive and resource_kind == "paper" and paper_strategy == "current":
            payload["startPublishedDate"] = (
                datetime.now(UTC) - timedelta(days=window_days)
            ).isoformat()
        headers = {"x-api-key": self.api_key, "Content-Type": "application/json"}
        async with httpx.AsyncClient(
            timeout=self.timeout_seconds, follow_redirects=False
        ) as client:
            response = await client.post("https://api.exa.ai/search", json=payload, headers=headers)
            response.raise_for_status()
        raw_body: object = response.json()
        if not isinstance(raw_body, dict):
            return []
        body = cast(dict[object, object], raw_body)
        raw_results = body.get("results", [])
        if not isinstance(raw_results, list):
            return []
        candidates: list[dict[str, Any]] = []
        seen: set[str] = set()
        for raw_item in cast(list[object], raw_results):
            if not isinstance(raw_item, dict):
                continue
            item = cast(dict[str, object], raw_item)
            url = item.get("url")
            if not isinstance(url, str):
                continue
            parsed = urlparse(url)
            if parsed.scheme != "https":
                continue
            if resource_kind == "video":
                candidate_id = youtube_id_from_url(url)
                if candidate_id is None or candidate_id in seen:
                    continue
                seen.add(candidate_id)
            elif not is_allowed_arxiv_url(url) or url in seen:
                continue
            else:
                seen.add(url)
            candidates.append(
                {
                    **item,
                    "retrieval_strategy": paper_strategy if resource_kind == "paper" else "video",
                }
            )
        return candidates
