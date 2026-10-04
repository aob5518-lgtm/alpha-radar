from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from alpha_radar.assets.models import Asset
from alpha_radar.events.models import Event, EventAsset, EventSourceReference
from alpha_radar.sources.models import Source, SourceDocument


@dataclass(frozen=True)
class EventRecord:
    event: Event
    assets: list[Asset]
    sources: list[tuple[EventSourceReference, SourceDocument, Source]]


class EventRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_events(
        self,
        *,
        page: int,
        page_size: int,
        start: datetime | None,
        end: datetime | None,
        importances: list[str],
        category: str | None,
        event_type: str | None,
        status: str | None,
        asset_id: UUID | None,
    ) -> tuple[list[EventRecord], int]:
        filters: list[ColumnElement[bool]] = []
        if start is not None:
            filters.append(
                or_(
                    Event.scheduled_at >= start,
                    and_(Event.scheduled_at.is_(None), Event.scheduled_date >= start.date()),
                )
            )
        if end is not None:
            filters.append(
                or_(
                    Event.scheduled_at < end,
                    and_(Event.scheduled_at.is_(None), Event.scheduled_date < end.date()),
                )
            )
        if importances:
            filters.append(Event.importance.in_(importances))
        if category:
            filters.append(Event.category == category)
        if event_type:
            filters.append(Event.event_type == event_type)
        if status:
            filters.append(Event.status == status)
        query = select(Event).where(*filters)
        if asset_id:
            query = query.join(EventAsset).where(EventAsset.asset_id == asset_id)
        count = int(
            await self.session.scalar(select(func.count()).select_from(query.subquery())) or 0
        )
        schedule_day = func.coalesce(func.date(Event.scheduled_at), Event.scheduled_date)
        rows = list(
            await self.session.scalars(
                query.order_by(
                    schedule_day.asc().nulls_last(),
                    Event.scheduled_at.asc().nulls_last(),
                    Event.id,
                )
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        return await self._hydrate_many(rows), count

    async def get(self, event_id: UUID) -> EventRecord | None:
        event = await self.session.get(Event, event_id)
        return await self._hydrate(event) if event else None

    async def _hydrate(self, event: Event) -> EventRecord:
        return (await self._hydrate_many([event]))[0]

    async def _hydrate_many(self, events: list[Event]) -> list[EventRecord]:
        if not events:
            return []
        event_ids = [event.id for event in events]
        assets_by_event: dict[UUID, list[Asset]] = {event_id: [] for event_id in event_ids}
        asset_rows = (
            await self.session.execute(
                select(EventAsset.event_id, Asset)
                .join(Asset, Asset.id == EventAsset.asset_id)
                .where(EventAsset.event_id.in_(event_ids))
                .order_by(EventAsset.event_id, Asset.symbol)
            )
        ).tuples()
        for event_id, asset in asset_rows:
            assets_by_event[event_id].append(asset)

        sources_by_event: dict[UUID, list[tuple[EventSourceReference, SourceDocument, Source]]] = {
            event_id: [] for event_id in event_ids
        }
        source_rows = (
            await self.session.execute(
                select(EventSourceReference, SourceDocument, Source)
                .join(
                    SourceDocument,
                    SourceDocument.id == EventSourceReference.source_document_id,
                )
                .join(Source, Source.id == SourceDocument.source_id)
                .where(EventSourceReference.event_id.in_(event_ids))
                .order_by(EventSourceReference.event_id, Source.slug)
            )
        ).tuples()
        for reference, document, source in source_rows:
            sources_by_event[reference.event_id].append((reference, document, source))
        return [
            EventRecord(
                event=event,
                assets=assets_by_event[event.id],
                sources=sources_by_event[event.id],
            )
            for event in events
        ]
