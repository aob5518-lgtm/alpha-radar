from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator

from alpha_radar.assets.schemas import PaginationMetadata

SourceType = Literal[
    "government",
    "regulator",
    "central_bank",
    "company",
    "exchange",
    "media",
    "specialist_media",
    "protocol",
    "social",
]
SourceTier = Literal["primary", "major_media", "specialist", "social"]
LicenseClass = Literal[
    "public_official", "metadata_only", "excerpt_allowed", "licensed", "unknown", "restricted"
]


class FetchedSourceDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    external_id: str | None = Field(default=None, max_length=512)
    canonical_url: str = Field(max_length=2048)
    document_type: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=1000)
    author: str | None = Field(default=None, max_length=255)
    language: str | None = Field(default=None, max_length=32)
    summary: str | None = Field(default=None, max_length=2000)
    excerpt: str | None = Field(default=None, max_length=2000)
    published_at: datetime | None = None
    publisher_updated_at: datetime | None = None
    observed_at: datetime
    fetched_at: datetime
    metadata: dict[str, JsonValue] = Field(default_factory=dict)

    @field_validator("published_at", "publisher_updated_at", "observed_at", "fetched_at")
    @classmethod
    def utc(cls, value: datetime | None) -> datetime | None:
        if value is not None:
            if value.tzinfo is None:
                raise ValueError("Timestamp must include a timezone")
            return value.astimezone(UTC)
        return None


class SourceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    slug: str
    name: str
    source_type: SourceType
    source_tier: SourceTier
    provider: str
    base_url: str
    language: str | None
    status: str
    latency_class: str
    license_class: LicenseClass
    terms_url: str | None


class VersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    version_number: int
    content_hash: str
    title: str
    summary: str | None
    excerpt: str | None
    published_at: datetime | None
    publisher_updated_at: datetime | None
    observed_at: datetime
    fetched_at: datetime
    ingested_at: datetime


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    source_id: UUID
    external_id: str | None
    canonical_url: str
    document_type: str
    title: str
    author: str | None
    language: str | None
    published_at: datetime | None
    publisher_updated_at: datetime | None
    first_observed_at: datetime
    last_observed_at: datetime
    first_fetched_at: datetime
    last_fetched_at: datetime
    ingested_at: datetime
    status: str
    source: SourceResponse
    current_version: VersionResponse


class SourceListResponse(BaseModel):
    items: list[SourceResponse]
    pagination: PaginationMetadata


class DocumentListResponse(BaseModel):
    items: list[DocumentResponse]
    pagination: PaginationMetadata
