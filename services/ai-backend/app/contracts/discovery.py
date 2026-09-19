from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ResourceKind = Literal["video", "paper"]
LearningLevel = Literal["beginner", "intermediate", "advanced", "mixed"]
PaperStrategy = Literal["current", "foundational"]
LearningFormat = Literal[
    "clear_explanations",
    "deep_dive",
    "hands_on",
    "research_backed",
    "quick_learning",
    "conversational",
    "mixed",
]


class DiscoveryRefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    concept_ids: list[UUID] = Field(default_factory=list, max_length=1)
    concept_names: list[str] = Field(default_factory=list, max_length=1)
    query_text: str | None = Field(default=None, min_length=2, max_length=240)
    source_kind: ResourceKind | None = None
    level: LearningLevel = "mixed"
    preferred_formats: list[str] = Field(default_factory=list, max_length=6)
    video_coverage: int = Field(default=0, ge=0, le=100)
    paper_coverage: int = Field(default=0, ge=0, le=100)
    window_days: int = Field(default=30, ge=1, le=365)
    paper_strategy: PaperStrategy = "current"
    force_refresh: bool = False
    audit_user_id: UUID | None = None
    trace_id: str | None = Field(default=None, min_length=1, max_length=128)

    @field_validator("concept_names")
    @classmethod
    def concept_names_match_ids(cls, values: list[str]) -> list[str]:
        if any(not value.strip() for value in values):
            raise ValueError("concept names must not be empty")
        return [value.strip() for value in values]

    @model_validator(mode="after")
    def concept_lists_match(self) -> "DiscoveryRefreshRequest":
        if len(self.concept_ids) != len(self.concept_names):
            raise ValueError("concept ids and names must have the same length")
        if not self.concept_ids and not self.query_text:
            raise ValueError("discovery refresh requires a canonical concept or query text")
        return self


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
    learning_format: LearningFormat | None = None
    estimated_level: LearningLevel | None = None
    has_implementation: bool | None = None
    evidence: list[str] = Field(default_factory=list, max_length=5)
    source: str = "exa"
    confidence: float = Field(ge=0, le=1)
    discovered_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class YoutubeEnrichment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relevant: bool
    concept_coverage: float = Field(ge=0, le=1)
    estimated_level: LearningLevel
    learning_format: LearningFormat
    has_implementation: bool | None = None
    evidence: list[str] = Field(min_length=1, max_length=5)
    confidence: float = Field(ge=0, le=1)


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
    provider_calls: int = Field(default=0, ge=0, le=100)
    fallback_calls: int = Field(default=0, ge=0, le=100)
    enrichment_calls: int = Field(default=0, ge=0, le=100)
    generated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
