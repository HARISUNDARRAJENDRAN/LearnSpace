import json
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any, cast

YOUTUBE_TTL = timedelta(hours=24)
ARXIV_TTL = timedelta(hours=24)
NEGATIVE_TTL = timedelta(minutes=15)
TOOL_VERSION = "discovery-tools-v1"


def _hash(value: str) -> str:
    return sha256(value.encode("utf-8")).hexdigest()[:24]


def youtube_cache_key(concept_id: str, level: str, learning_format: str, window: int) -> str:
    return f"ls:v1:discovery:youtube:{concept_id}:{level}:{learning_format}:{window}:{TOOL_VERSION}"


def arxiv_cache_key(concept_id: str, level: str, window: int) -> str:
    return f"ls:v1:discovery:arxiv:{concept_id}:{level}:{window}:{TOOL_VERSION}"


def exa_cache_key(query: str, filters: str) -> str:
    return f"ls:v1:exa:{_hash(query)}:{_hash(filters)}:{TOOL_VERSION}"


@dataclass
class CacheEntry:
    value: list[dict[str, Any]]
    expires_at: datetime


@dataclass
class DiscoveryCache:
    entries: dict[str, CacheEntry] = field(default_factory=lambda: {})
    redis_url: str | None = None
    redis_client: Any = field(default=None, init=False, repr=False)

    async def _redis(self) -> Any:
        if not self.redis_url:
            return None
        if self.redis_client is None:
            from redis.asyncio import from_url

            self.redis_client = from_url(self.redis_url, decode_responses=True)
        return self.redis_client

    async def get(self, key: str) -> list[dict[str, Any]] | None:
        try:
            redis = await self._redis()
            if redis is not None:
                value = await redis.get(key)
                if value is not None:
                    parsed: object = json.loads(value)
                    if isinstance(parsed, list):
                        return [
                            item for item in cast(list[object], parsed) if isinstance(item, dict)
                        ]
        except Exception:
            pass
        entry = self.entries.get(key)
        if entry is None or entry.expires_at <= datetime.now(UTC):
            return None
        return entry.value

    async def set(
        self, key: str, value: list[dict[str, Any]], ttl: timedelta = YOUTUBE_TTL
    ) -> None:
        try:
            redis = await self._redis()
            if redis is not None:
                await redis.set(key, json.dumps(value), ex=max(1, int(ttl.total_seconds())))
        except Exception:
            pass
        self.entries[key] = CacheEntry(value=value, expires_at=datetime.now(UTC) + ttl)

    async def has_enough(self, keys: list[str], minimum: int) -> bool:
        values = [await self.get(key) for key in keys]
        return sum(len(value or []) for value in values) >= minimum
