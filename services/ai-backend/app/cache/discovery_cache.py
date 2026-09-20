import json
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any, cast

YOUTUBE_TTL = timedelta(hours=24)
ARXIV_TTL = timedelta(hours=24)
NEGATIVE_TTL = timedelta(minutes=15)
STALE_TTL = timedelta(days=7)
TOOL_VERSION = "discovery-tools-v1"


def _hash(value: str) -> str:
    return sha256(value.encode("utf-8")).hexdigest()[:24]


def youtube_cache_key(concept_id: str, level: str, learning_format: str, window: int) -> str:
    return f"ls:v1:discovery:youtube:{concept_id}:mixed:any:{window}:{TOOL_VERSION}"


def arxiv_cache_key(
    concept_id: str, level: str, window: int, paper_strategy: str = "current"
) -> str:
    return f"ls:v1:discovery:arxiv:{concept_id}:mixed:{paper_strategy}:{window}:{TOOL_VERSION}"


def exa_cache_key(query: str, filters: str) -> str:
    return f"ls:v1:exa:{_hash(query)}:{_hash(filters)}:{TOOL_VERSION}"


def query_cache_identity(query: str) -> str:
    normalized = " ".join(query.split()).lower()
    return f"query:{_hash(normalized)}"


def instant_cache_key(resource_kind: str, query: str, ranking_intent: str) -> str:
    normalized = " ".join(query.split()).lower()
    return f"ls:v1:discovery:instant:{resource_kind}:{ranking_intent}:{_hash(normalized)}"


@dataclass
class CacheEntry:
    value: list[dict[str, Any]]
    expires_at: datetime
    stale_until: datetime


@dataclass
class DiscoveryCache:
    entries: dict[str, CacheEntry] = field(default_factory=lambda: {})
    redis_url: str | None = None
    max_local_entries: int = 256
    redis_client: Any = field(default=None, init=False, repr=False)

    async def _redis(self) -> Any:
        if not self.redis_url:
            return None
        if self.redis_client is None:
            from redis.asyncio import from_url

            self.redis_client = from_url(self.redis_url, decode_responses=True)
        return self.redis_client

    @staticmethod
    def _decode(value: str, *, stale: bool) -> list[dict[str, Any]] | None:
        parsed: object = json.loads(value)
        if not isinstance(parsed, dict):
            return None
        payload = cast(dict[str, object], parsed)
        if not isinstance(payload.get("value"), list):
            return None
        fresh_until = payload.get("freshUntil")
        stale_until = payload.get("staleUntil")
        if not isinstance(fresh_until, str) or not isinstance(stale_until, str):
            return None
        now = datetime.now(UTC)
        try:
            fresh_expiry = datetime.fromisoformat(fresh_until)
            stale_expiry = datetime.fromisoformat(stale_until)
        except ValueError:
            return None
        if (not stale and fresh_expiry <= now) or stale_expiry <= now:
            return None
        return [item for item in cast(list[object], payload["value"]) if isinstance(item, dict)]

    async def get(self, key: str) -> list[dict[str, Any]] | None:
        entry = self.entries.get(key)
        if entry is not None and entry.expires_at > datetime.now(UTC):
            self.entries.pop(key, None)
            self.entries[key] = entry
            return entry.value
        try:
            redis = await self._redis()
            if redis is not None:
                value = await redis.get(key)
                if value is not None:
                    decoded = self._decode(value, stale=False)
                    if decoded is not None:
                        return decoded
        except Exception:
            pass
        return None

    async def set(
        self, key: str, value: list[dict[str, Any]], ttl: timedelta = YOUTUBE_TTL
    ) -> None:
        now = datetime.now(UTC)
        self.entries.pop(key, None)
        self.entries[key] = CacheEntry(
            value=value, expires_at=now + ttl, stale_until=now + ttl + STALE_TTL
        )
        while len(self.entries) > max(1, self.max_local_entries):
            self.entries.pop(next(iter(self.entries)))
        try:
            redis = await self._redis()
            if redis is not None:
                payload = {
                    "value": value,
                    "freshUntil": (now + ttl).isoformat(),
                    "staleUntil": (now + ttl + STALE_TTL).isoformat(),
                }
                await redis.set(
                    key,
                    json.dumps(payload),
                    ex=max(1, int((ttl + STALE_TTL).total_seconds())),
                )
        except Exception:
            pass

    async def get_stale(self, key: str) -> list[dict[str, Any]] | None:
        entry = self.entries.get(key)
        if entry is not None and entry.stale_until > datetime.now(UTC):
            self.entries.pop(key, None)
            self.entries[key] = entry
            return entry.value
        try:
            redis = await self._redis()
            if redis is not None:
                value = await redis.get(key)
                if value is not None:
                    decoded = self._decode(value, stale=True)
                    if decoded is not None:
                        return decoded
        except Exception:
            pass
        return None

    async def has_enough(self, keys: list[str], minimum: int) -> bool:
        values = [await self.get(key) for key in keys]
        return sum(len(value or []) for value in values) >= minimum
