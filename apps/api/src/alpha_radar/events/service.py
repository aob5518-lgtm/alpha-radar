from datetime import datetime
from math import ceil
from uuid import UUID

from alpha_radar.assets.schemas import PaginationMetadata
from alpha_radar.errors import AppError
from alpha_radar.events.repository import EventRecord, EventRepository
from alpha_radar.events.schemas import (
    EventAssetResponse,
    EventListResponse,
    EventResponse,
    EventSourceResponse,
)


class EventService:
    def __init__(self, repository: EventRepository) -> None:
        self.repository = repository

    @staticmethod
    def response(record: EventRecord) -> EventResponse:
        event = record.event
        return EventResponse.model_validate(
            {
                **{
                    key: getattr(event, key)
                    for key in EventResponse.model_fields
                    if key not in {"affected_assets", "sources"}
                },
                "affected_assets": [
                    EventAssetResponse(
                        id=asset.id, symbol=asset.symbol, slug=asset.slug, name=asset.name
                    )
                    for asset in record.assets
                ],
                "sources": [
                    EventSourceResponse(
                        source_id=source.id,
                        source_document_id=document.id,
                        source_name=source.name,
                        title=document.title,
                        canonical_url=document.canonical_url,
                        published_at=document.published_at,
                    )
                    for document, source in record.sources
                ],
            }
        )

    async def list(
        self,
        *,
        page: int,
        page_size: int,
        start: datetime | None,
        end: datetime | None,
        importances: list[str],
        event_type: str | None,
        status: str | None,
        asset_id: UUID | None,
    ) -> EventListResponse:
        rows, count = await self.repository.list_events(
            page=page,
            page_size=page_size,
            start=start,
            end=end,
            importances=importances,
            event_type=event_type,
            status=status,
            asset_id=asset_id,
        )
        return EventListResponse(
            items=[self.response(row) for row in rows],
            pagination=PaginationMetadata(
                page=page,
                page_size=page_size,
                total_items=count,
                total_pages=ceil(count / page_size),
            ),
        )

    async def detail(self, event_id: UUID) -> EventResponse:
        row = await self.repository.get(event_id)
        if row is None:
            raise AppError(code="event_not_found", message="Event not found", status_code=404)
        return self.response(row)
