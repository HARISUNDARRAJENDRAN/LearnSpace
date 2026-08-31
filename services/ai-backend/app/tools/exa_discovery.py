from datetime import UTC, datetime, timedelta
from typing import Any, cast
from urllib.parse import urlparse

import httpx

from app.contracts.discovery import ResourceKind
from app.guardrails.candidate_validation import is_allowed_arxiv_url, youtube_id_from_url


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
    ) -> list[dict[str, Any]]:
        if not self.api_key:
            return []
        domain = "youtube.com" if resource_kind == "video" else "arxiv.org"
        start = datetime.now(UTC) - timedelta(days=window_days)
        payload = {
            "query": " educational " + " ".join(concept_names),
            "type": "neural",
            "numResults": min(10, max(1, limit)),
            "includeDomains": [domain],
            "startPublishedDate": start.isoformat(),
            "contents": {"highlights": {"maxCharacters": 800}},
        }
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
            candidates.append(item)
        return candidates
