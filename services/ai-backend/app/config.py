import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    internal_service_token: str
    exa_api_key: str | None
    agents_enabled: bool
    max_concurrency: int
    max_tool_calls: int
    request_timeout_seconds: float
    redis_url: str | None
    database_ai_url: str | None
    youtube_enrichment_enabled: bool = False
    interactive_timeout_seconds: float = 1.2
    build_sha: str = "unknown"
    protocol_version: str = "source-discovery-v3"
    schema_version: str = "1"

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            internal_service_token=os.getenv("INTERNAL_SERVICE_TOKEN", ""),
            exa_api_key=os.getenv("EXA_API_KEY"),
            agents_enabled=os.getenv("DISCOVERY_AGENTS_ENABLED", "false").lower() == "true",
            max_concurrency=max(1, min(4, int(os.getenv("DISCOVERY_MAX_CONCURRENCY", "2")))),
            max_tool_calls=max(3, min(10, int(os.getenv("DISCOVERY_MAX_TOOL_CALLS", "4")))),
            request_timeout_seconds=max(
                1.0, min(30.0, float(os.getenv("DISCOVERY_REQUEST_TIMEOUT_SECONDS", "8")))
            ),
            redis_url=os.getenv("REDIS_URL"),
            database_ai_url=os.getenv("DATABASE_AI_URL"),
            youtube_enrichment_enabled=os.getenv(
                "DISCOVERY_YOUTUBE_ENRICHMENT_ENABLED", "false"
            ).lower()
            == "true",
            interactive_timeout_seconds=max(
                0.5, min(5.0, float(os.getenv("DISCOVERY_INTERACTIVE_TIMEOUT_SECONDS", "1.2")))
            ),
            build_sha=os.getenv("DISCOVERY_BUILD_SHA", "unknown"),
            protocol_version=os.getenv("DISCOVERY_PROTOCOL_VERSION", "source-discovery-v3"),
            schema_version=os.getenv("DISCOVERY_SCHEMA_VERSION", "1"),
        )

    def readiness_errors(self) -> list[str]:
        errors: list[str] = []
        if not self.internal_service_token:
            errors.append("INTERNAL_SERVICE_TOKEN")
        if self.agents_enabled:
            if not self.exa_api_key:
                errors.append("EXA_API_KEY")
            if self.youtube_enrichment_enabled and not os.getenv("OPENAI_API_KEY"):
                errors.append("OPENAI_API_KEY")
        return errors

    def ready(self) -> bool:
        return not self.readiness_errors()
