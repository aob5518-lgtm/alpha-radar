from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from alpha_radar.assets.schemas import PaginationMetadata

EventImportance = Literal["critical", "high", "medium", "low"]
EventCategory = Literal["macro", "crypto"]
OpportunitySignal = Literal["none", "watch", "research", "prepare", "wait", "avoid"]
RecommendedAction = Literal[
    "watch", "research", "prepare", "wait_for_confirmation", "caution", "avoid"
]
ConfidenceBand = Literal["low", "medium", "high"]
EventStatus = Literal[
    "rumored", "scheduled", "confirmed", "ongoing", "completed", "cancelled", "superseded"
]


class EventAssetResponse(BaseModel):
    id: UUID
    symbol: str
    slug: str
    name: str


class EventSourceResponse(BaseModel):
    source_id: UUID
    source_document_id: UUID
    source_name: str
    source_type: str
    source_tier: str
    evidence_role: str
    title: str
    canonical_url: str
    published_at: datetime | None


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    category: EventCategory
    event_type: str
    status: EventStatus
    scheduled_date: date | None
    scheduled_at: datetime | None
    scheduled_timezone: str | None
    actual_release_at: datetime | None
    detected_at: datetime
    updated_at: datetime
    importance: EventImportance
    summary: str
    signal: str | None
    why_it_matters: str
    risk: str | None
    recommended_action: RecommendedAction | None
    opportunity_signal: OpportunitySignal | None
    confidence: ConfidenceBand | None
    contract_address: str | None
    actual: str | None
    forecast: str | None
    previous: str | None
    affected_assets: list[EventAssetResponse]
    impact_analysis: dict[str, object]
    bull_case: str | None
    bear_case: str | None
    watch_next: list[str]
    sources: list[EventSourceResponse]


class EventListResponse(BaseModel):
    items: list[EventResponse]
    pagination: PaginationMetadata
