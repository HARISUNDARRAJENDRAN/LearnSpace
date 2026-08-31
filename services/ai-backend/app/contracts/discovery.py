from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

ResourceKind = Literal["video", "paper"]
LearningLevel = Literal["beginner", "intermediate", "advanced", "mixed"]


class DiscoveryRefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    concept_ids: list[UUID] = Field(min_length=1, max_length=20)
    concept_names: list[str] = Field(min_length=1, max_length=20)
    level: LearningLevel = "mixed"
    preferred_formats: list[str] = Field(default_factory=list, max_length=6)
    video_coverage: int = Field(default=0, ge=0, le=100)
    paper_coverage: int = Field(default=0, ge=0, le=100)
    window_days: int = Field(default=30, ge=1, le=365)
    audit_user_id: UUID | None = None
    trace_id: str | None = Field(default=None, min_length=1, max_length=128)

    @field_validator("concept_names")
    @classmethod
    def concept_names_match_ids(cls, values: list[str]) -> list[str]:
        if any(not value.strip() for value in values):
            raise ValueError("concept names must not be empty")
        return [value.strip() for value in values]


class YoutubeCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    youtube_id: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    canonical_url: str
    title: str = Field(min_length=3, max_length=500)
    channel: str | None = None
    published_at: datetime | None = None
    duration_ms: int | None = Field(default=None, ge=0)
    language: str | None = None
    matched_concept_ids: list[UUID] = Field(default_factory=lambda: list[UUID](), max_length=20)
    learning_format: str | None = None
    estimated_level: LearningLevel | None = None
    evidence: list[str] = Field(default_factory=list, max_length=5)
    source: str = "exa"
    confidence: float = Field(ge=0, le=1)
    discovered_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ArxivCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    arxiv_id: str = Field(min_length=3, max_length=100)
    canonical_url: str
    title: str = Field(min_length=3, max_length=500)
    authors: list[str] = Field(default_factory=list, max_length=50)
    abstract: str | None = None
    published_at: datetime | None = None
    categories: list[str] = Field(default_factory=list, max_length=20)
    matched_concept_ids: list[UUID] = Field(default_factory=lambda: list[UUID](), max_length=20)
    estimated_level: LearningLevel | None = None
    paper_class: Literal["current", "foundational"] = "current"
    evidence: list[str] = Field(default_factory=list, max_length=5)
    source: str = "exa"
    confidence: float = Field(ge=0, le=1)
    discovered_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class DiscoveryCandidateBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    trace_id: str
    skipped: list[ResourceKind] = Field(default_factory=lambda: list[ResourceKind]())
    youtube: list[YoutubeCandidate] = Field(
        default_factory=lambda: list[YoutubeCandidate](), max_length=50
    )
    arxiv: list[ArxivCandidate] = Field(
        default_factory=lambda: list[ArxivCandidate](), max_length=50
    )
    cache_hit: bool = False
    failures: list[str] = Field(default_factory=list, max_length=10)
    audit_run_id: UUID | None = None
    generated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
